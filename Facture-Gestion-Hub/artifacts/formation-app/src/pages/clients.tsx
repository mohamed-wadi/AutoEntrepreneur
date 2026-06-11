import { useState } from "react";
import { Redirect } from "wouter";
import {
  useListClients,
  getListClientsQueryKey,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  useGetStats,
  getGetStatsQueryKey,
} from "@workspace/api-client-react";
import type { Client } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Loader2, Users, Building2, Phone, User, Hash, Search, Eye, Download, Upload, FileText, Image, ChevronDown, TrendingUp } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { fetchStorageBlobForPreview } from "@/lib/storage-url";
import { API_BASE } from "@/lib/api-base";
import { FilePreviewDialog, type FilePreviewPayload } from "@/components/file-preview-dialog";

const clientSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  city: z.string().nullable().optional(),
  contact: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  ice: z.string().nullable().optional(),
});

type ClientFormValues = z.infer<typeof clientSchema>;
type CabinetFile = {
  id: number;
  clientId: number;
  name: string;
  url: string;
  contentType: string | null;
  uploadedAt: string;
};

const BASE = API_BASE;

function isImageFile(ct: string | null, name: string): boolean {
  if (ct && ct.startsWith("image/")) return true;
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name);
}

async function requestUploadUrl(file: File): Promise<{ uploadURL: string; objectPath: string }> {
  const res = await fetch(`${BASE}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string; uploadURL?: string; objectPath?: string };
  if (!res.ok) throw new Error(payload.error || `Impossible d'obtenir l'URL d'upload (${res.status})`);
  if (!payload.uploadURL || !payload.objectPath) throw new Error("Réponse serveur invalide pour l'upload");
  return { uploadURL: payload.uploadURL, objectPath: payload.objectPath };
}

async function uploadToGcs(file: File, uploadURL: string): Promise<void> {
  const absolute = uploadURL.startsWith("http://") || uploadURL.startsWith("https://")
    ? uploadURL
    : new URL(uploadURL, window.location.origin).href;
  const crossOrigin = absolute.startsWith("http") && new URL(absolute).origin !== window.location.origin;
  const res = await fetch(absolute, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
    credentials: crossOrigin ? "omit" : "include",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || "Échec du téléchargement");
  }
}

export function Clients() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const now = new Date();
  const currentYear = now.getFullYear();

  const { data: stats } = useGetStats(
    { year: currentYear },
    { query: { queryKey: getGetStatsQueryKey({ year: currentYear }), enabled: !!user } }
  );

  // Build a map: cabinetName -> totalMontant for current year
  const cabinetCaMap = new Map<string, number>();
  for (const c of stats?.byCabinet ?? []) {
    const prev = cabinetCaMap.get(c.cabinetName) ?? 0;
    cabinetCaMap.set(c.cabinetName, prev + c.totalMontant);
  }

  const PLAFOND_CABINET = 100_000;
  const formatDH = (n: number) => new Intl.NumberFormat('fr-MA', { style: 'currency', currency: 'MAD', maximumFractionDigits: 0 }).format(n);

  function caColor(total: number) {
    if (total >= PLAFOND_CABINET) return "bg-red-100 text-red-700 border-red-300";
    if (total >= PLAFOND_CABINET * 0.8) return "bg-orange-100 text-orange-700 border-orange-300";
    if (total > 0) return "bg-emerald-100 text-emerald-700 border-emerald-300";
    return "bg-slate-100 text-slate-500 border-slate-200";
  }

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [uploadingByClient, setUploadingByClient] = useState<Record<number, boolean>>({});
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [deletingFile, setDeletingFile] = useState<{ clientId: number; fileId: number } | null>(null);

  const { data: clients = [], isLoading } = useListClients({
    query: { queryKey: getListClientsQueryKey(), enabled: !!user },
  });
  const { data: cabinetFiles = [] } = useQuery<CabinetFile[]>({
    queryKey: ["cabinet-files"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/cabinet-files`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur de chargement des fichiers");
      return res.json();
    },
    enabled: !!user,
  });

  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const deleteCabinetFile = useMutation({
    mutationFn: async ({ clientId, fileId }: { clientId: number; fileId: number }) => {
      const res = await fetch(`${BASE}/api/clients/${clientId}/files/${fileId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erreur de suppression");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cabinet-files"] });
      setDeletingFile(null);
      toast({ title: "Fichier supprimé" });
    },
    onError: () => toast({ variant: "destructive", title: "Erreur de suppression du fichier" }),
  });

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: { name: "", city: "", contact: "", phone: "", ice: "" },
  });

  const openCreate = () => {
    setEditingClient(null);
    form.reset({ name: "", city: "", contact: "", phone: "", ice: "" });
    setIsFormOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    form.reset({
      name: client.name,
      city: client.city ?? "",
      contact: client.contact ?? "",
      phone: client.phone ?? "",
      ice: client.ice ?? "",
    });
    setIsFormOpen(true);
  };

  const onSubmit = (values: ClientFormValues) => {
    const data = {
      name: values.name,
      city: values.city || null,
      contact: values.contact || null,
      phone: values.phone || null,
      ice: values.ice || null,
    };

    if (editingClient) {
      updateClient.mutate(
        { id: editingClient.id, data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
            setIsFormOpen(false);
            toast({ title: "Cabinet mis à jour" });
          },
          onError: () => toast({ variant: "destructive", title: "Erreur lors de la mise à jour du cabinet" }),
        }
      );
    } else {
      createClient.mutate(
        { data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
            setIsFormOpen(false);
            toast({ title: "Cabinet ajouté" });
          },
          onError: () => toast({ variant: "destructive", title: "Erreur lors de la création du cabinet" }),
        }
      );
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteClient.mutate(
      { id: deletingId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setDeletingId(null);
          toast({ title: "Cabinet supprimé" });
        },
        onError: () => toast({ variant: "destructive", title: "Erreur lors de la suppression du cabinet" }),
      }
    );
  };

  if (isAuthLoading) return null;
  if (!user) return <Redirect to="/" />;

  const closePreview = () => {
    if (preview?.blobUrl) URL.revokeObjectURL(preview.blobUrl);
    setPreview(null);
  };

  const runPreview = async (url: string, fileName: string, fileId: number) => {
    setPreviewLoadingId(fileId);
    try {
      const { blobUrl, mime } = await fetchStorageBlobForPreview(url);
      setPreview({ blobUrl, fileName, mime });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Aperçu impossible",
        description: err instanceof Error ? err.message : "Erreur",
      });
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const filesByClient = new Map<number, CabinetFile[]>();
  for (const f of cabinetFiles) {
    const arr = filesByClient.get(f.clientId) ?? [];
    arr.push(f);
    filesByClient.set(f.clientId, arr);
  }

  const uploadFilesForClient = async (clientId: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingByClient((prev) => ({ ...prev, [clientId]: true }));
    try {
      for (const file of Array.from(files)) {
        const { uploadURL, objectPath } = await requestUploadUrl(file);
        await uploadToGcs(file, uploadURL);
        const fileUrl = `${BASE}/api/storage${objectPath}?filename=${encodeURIComponent(file.name)}`;
        const res = await fetch(`${BASE}/api/clients/${clientId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name: file.name, url: fileUrl, contentType: file.type || null }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({} as { error?: string }));
          throw new Error(payload.error || `Erreur enregistrement fichier (${file.name})`);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["cabinet-files"] });
      toast({ title: "Fichiers ajoutés" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur d'upload",
        description: err instanceof Error ? err.message : "Échec",
      });
    } finally {
      setUploadingByClient((prev) => ({ ...prev, [clientId]: false }));
    }
  };


  const filteredClients = clients.filter(client => 
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (client.city && client.city.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <Layout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cabinets</h1>
          <p className="text-slate-500 mt-1">{clients.length} cabinets / organisateurs enregistrés</p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate} data-testid="btn-add-client">
            <Plus className="h-4 w-4 mr-2" /> Nouveau cabinet
          </Button>
        )}
      </div>

      <div className="mb-6 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input 
          placeholder="Rechercher un cabinet (nom, ville)..." 
          className="pl-9"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <Users className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg">{searchTerm ? "Aucun cabinet trouvé" : "Aucun cabinet enregistré"}</p>
          {!searchTerm && (
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> Ajouter le premier cabinet
            </Button>
          )}
        </div>
      ) : (
        <figure className="m-0 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">Liste des clients enregistrés</caption>
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wide">
                <th scope="col" className="px-4 py-3 text-left">Cabinet / Organisateur</th>
                <th scope="col" className="px-4 py-3 text-left">Ville</th>
                <th scope="col" className="px-4 py-3 text-left">Contact</th>
                <th scope="col" className="px-4 py-3 text-left">Téléphone</th>
                <th scope="col" className="px-4 py-3 text-left">ICE</th>
                <th scope="col" className="px-4 py-3 text-left">CA {currentYear}</th>
                <th scope="col" className="px-4 py-3 text-left">Fichiers</th>
                {isAdmin && <th scope="col" className="px-4 py-3 text-center w-28">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
                <tr
                  key={client.id}
                  className="border-b border-slate-100 last:border-b-0 odd:bg-slate-200 even:bg-white hover:bg-slate-300/70 transition-colors"
                  data-testid={`card-client-${client.id}`}
                >
                  <th scope="row" className="px-4 py-3 text-left font-medium text-slate-900" data-testid={`text-client-name-${client.id}`}>
                    <span className="inline-flex max-w-[16rem] min-w-0 items-center gap-2">
                      <abbr
                        title={client.name}
                        className="flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary no-underline"
                      >
                        {client.name.charAt(0).toUpperCase()}
                      </abbr>
                      <span className="truncate">{client.name}</span>
                    </span>
                  </th>
                  <td className="px-4 py-3 text-slate-600">
                    {client.city ? (
                      <>
                        <Building2 className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom text-slate-400" aria-hidden />
                        {client.city}
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {client.contact ? (
                      <>
                        <User className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom text-slate-400" aria-hidden />
                        {client.contact}
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {client.phone ? (
                      <>
                        <Phone className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom text-slate-400" aria-hidden />
                        {client.phone}
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {client.ice ? (
                      <>
                        <Hash className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom text-slate-400" aria-hidden />
                        {client.ice}
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const total = cabinetCaMap.get(client.name) ?? 0;
                      const ratio = Math.min(total / PLAFOND_CABINET, 1);
                      return (
                        <div className="min-w-[130px]">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${caColor(total)}`}>
                            <TrendingUp className="h-3 w-3" />
                            {total > 0 ? formatDH(total) : "—"}
                          </span>
                          {total > 0 && (
                            <div className="mt-1 w-full bg-slate-200 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${total >= PLAFOND_CABINET ? 'bg-red-500' : total >= PLAFOND_CABINET * 0.8 ? 'bg-orange-400' : 'bg-emerald-500'}`}
                                style={{ width: `${ratio * 100}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-slate-600 align-top">
                    <div className="min-w-[320px] space-y-2">
                      {(() => {
                        const files = filesByClient.get(client.id) ?? [];
                        const hasFiles = files.length > 0;
                        return (
                          <>
                      <div className="flex items-center justify-between gap-2">
                        {isAdmin ? (
                          <label className="inline-flex">
                            <input
                              type="file"
                              multiple
                              className="hidden"
                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,image/*,application/pdf"
                              onChange={(e) => {
                                void uploadFilesForClient(client.id, e.target.files);
                                e.currentTarget.value = "";
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className={`h-7 px-2 text-xs ${hasFiles ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : ""}`}
                              disabled={!!uploadingByClient[client.id]}
                              onClick={(e) => {
                                const input = (e.currentTarget.parentElement?.querySelector("input[type='file']") as HTMLInputElement | null);
                                input?.click();
                              }}
                            >
                              {uploadingByClient[client.id] ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                              Ajouter
                            </Button>
                          </label>
                        ) : <span />}
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${hasFiles ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {files.length} fichier(s)
                        </span>
                      </div>
                      <details className={`group rounded border ${hasFiles ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-slate-50"}`}>
                        <summary className="flex cursor-pointer list-none items-center justify-between px-2 py-1.5 text-xs text-slate-700">
                          <span>
                            {!hasFiles
                              ? "Aucun fichier"
                              : "Voir les fichiers"}
                          </span>
                          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                        </summary>
                        {hasFiles ? (
                          <ul className="max-h-44 space-y-1 overflow-auto border-t border-slate-200 px-2 py-2">
                            {files.map((file) => (
                              <li key={file.id} className="flex items-center justify-between gap-2 text-xs">
                                <span className="truncate" title={file.name}>
                                  {isImageFile(file.contentType, file.name) ? <Image className="mr-1 inline h-3 w-3 text-blue-500" /> : <FileText className="mr-1 inline h-3 w-3 text-slate-500" />}
                                  {file.name}
                                </span>
                                <span className="inline-flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    title="Aperçu"
                                    className="rounded p-1 text-blue-600 hover:bg-blue-50"
                                    onClick={() => void runPreview(file.url, file.name, file.id)}
                                  >
                                    {previewLoadingId === file.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                                  </button>
                                  <a href={file.url} download={file.name} title="Télécharger" className="rounded p-1 text-slate-600 hover:bg-slate-100">
                                    <Download className="h-3.5 w-3.5" />
                                  </a>
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      title="Supprimer"
                                      className="rounded p-1 text-red-500 hover:bg-red-50"
                                      onClick={() => setDeletingFile({ clientId: client.id, fileId: file.id })}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </details>
                          </>
                        );
                      })()}
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 mr-1"
                        onClick={() => openEdit(client)}
                        data-testid={`btn-edit-client-${client.id}`}
                        type="button"
                        title="Modifier"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => setDeletingId(client.id)}
                        data-testid={`btn-delete-client-${client.id}`}
                        type="button"
                        title="Supprimer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingClient ? "Modifier le cabinet" : "Nouveau cabinet"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="name">Nom / Raison sociale *</Label>
              <Input
                id="name"
                {...form.register("name")}
                placeholder="Ex: LMC Casablanca"
                data-testid="input-client-name"
              />
              {form.formState.errors.name && (
                <p className="text-xs text-red-500 mt-1">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="city">Ville</Label>
              <Input
                id="city"
                {...form.register("city")}
                placeholder="Ex: Casablanca"
                data-testid="input-client-city"
              />
            </div>
            <div>
              <Label htmlFor="contact">Contact</Label>
              <Input
                id="contact"
                {...form.register("contact")}
                placeholder="Nom du contact"
                data-testid="input-client-contact"
              />
            </div>
            <div>
              <Label htmlFor="phone">Téléphone</Label>
              <Input
                id="phone"
                {...form.register("phone")}
                placeholder="Ex: +212 6 XX XX XX XX"
                data-testid="input-client-phone"
              />
            </div>
            <div>
              <Label htmlFor="ice">ICE</Label>
              <Input
                id="ice"
                {...form.register("ice")}
                placeholder="Ex: 003503208000024"
                data-testid="input-client-ice"
              />
              <p className="text-xs text-slate-400 mt-1">Identifiant Commun de l'Entreprise (15 chiffres)</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={createClient.isPending || updateClient.isPending}
                data-testid="btn-submit-client"
              >
                {(createClient.isPending || updateClient.isPending) ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</>
                ) : (
                  editingClient ? "Mettre à jour" : "Ajouter"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deletingId !== null} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce cabinet ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le cabinet sera définitivement supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDelete}
              data-testid="btn-confirm-delete-client"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {preview ? (
        <FilePreviewDialog
          payload={preview}
          onOpenChange={(open) => {
            if (!open) closePreview();
          }}
        />
      ) : null}

      <AlertDialog open={deletingFile !== null} onOpenChange={() => setDeletingFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce fichier ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (!deletingFile) return;
                deleteCabinetFile.mutate(deletingFile);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

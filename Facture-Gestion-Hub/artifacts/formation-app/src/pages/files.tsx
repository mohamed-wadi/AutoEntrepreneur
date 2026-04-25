import { useState, useRef } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/lib/auth";
import { API_BASE } from "@/lib/api-base";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Folder,
  Upload,
  Trash2,
  Loader2,
  Eye,
  FileText,
  Image,
  Download,
  Search,
} from "lucide-react";
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
import { fetchStorageBlobForPreview } from "@/lib/storage-url";
import { FilePreviewDialog, type FilePreviewPayload } from "@/components/file-preview-dialog";

interface GlobalFile {
  id: number;
  name: string;
  url: string;
  contentType: string | null;
  uploadedAt: string;
}

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

export function Files() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);

  const closePreview = () => {
    if (preview?.blobUrl) URL.revokeObjectURL(preview.blobUrl);
    setPreview(null);
  };

  const runPreview = async (url: string, fileName: string, fileId: number) => {
    setPreviewLoadingId(fileId);
    try {
      const { blobUrl, mime } = await fetchStorageBlobForPreview(url);
      setPreview({ blobUrl, fileName, mime });
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Aperçu impossible",
        description: err instanceof Error ? err.message : "Erreur",
      });
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const { data: files = [], isLoading } = useQuery<GlobalFile[]>({
    queryKey: ["global-files"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/global-files`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur de chargement");
      return res.json();
    },
    enabled: !!user,
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/global-files/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erreur lors de la suppression");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["global-files"] });
      setDeletingId(null);
      toast({ title: "Fichier supprimé" });
    },
    onError: () => toast({ variant: "destructive", title: "Erreur de suppression" }),
  });

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUploadUrl(file);
      await uploadToGcs(file, uploadURL);
      const fileUrl = `${BASE}/api/storage${objectPath}?filename=${encodeURIComponent(file.name)}`;

      const res = await fetch(`${BASE}/api/global-files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: file.name, url: fileUrl, contentType: file.type }),
      });
      if (!res.ok) throw new Error("Erreur lors de l'enregistrement");

      queryClient.invalidateQueries({ queryKey: ["global-files"] });
      toast({ title: "Fichier ajouté", description: file.name });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur d'upload",
        description: err instanceof Error ? err.message : "Échec",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (isAuthLoading) return null;
  if (!user) return <Redirect to="/" />;

  const filteredFiles = files.filter(f =>
    f.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-MA", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <Layout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mes Fichiers</h1>
          <p className="text-slate-500 mt-1">
            Centralisez vos documents officiels (RC, statuts, accusés, etc.)
          </p>
        </div>
        {isAdmin && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,image/*,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {isUploading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Upload en cours…</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" />Ajouter un fichier</>
              )}
            </Button>
          </>
        )}
      </div>

      <div className="mb-6 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Rechercher un fichier..."
          className="pl-9"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <Folder className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg">{searchTerm ? "Aucun résultat trouvé" : "Aucun fichier déposé"}</p>
          {!searchTerm && isAdmin && (
            <Button className="mt-4" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Déposer le premier fichier
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Fichier</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Date d'ajout</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file) => (
                <tr key={file.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                        {isImageFile(file.contentType, file.name) ? (
                          <Image className="h-4 w-4 text-blue-500" />
                        ) : (
                          <FileText className="h-4 w-4 text-slate-400" />
                        )}
                      </div>
                      <span className="font-medium text-slate-800 truncate max-w-xs" title={file.name}>
                        {file.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                    {file.contentType ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(file.uploadedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        title="Aperçu"
                        disabled={previewLoadingId === file.id}
                        className="p-1.5 rounded-md text-blue-500 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:opacity-50"
                        onClick={() => void runPreview(file.url, file.name, file.id)}
                      >
                        {previewLoadingId === file.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                      <a
                        href={file.url}
                        download={file.name}
                        title="Télécharger"
                        className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      {isAdmin && (
                        <button
                          onClick={() => setDeletingId(file.id)}
                          title="Supprimer"
                          className="p-1.5 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview ? (
        <FilePreviewDialog
          payload={preview}
          onOpenChange={(open) => {
            if (!open) closePreview();
          }}
        />
      ) : null}

      <AlertDialog open={deletingId !== null} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce fichier ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le fichier sera définitivement supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deletingId && deleteFileMutation.mutate(deletingId)}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

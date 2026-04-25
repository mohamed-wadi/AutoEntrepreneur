import { useState } from "react";
import { Redirect } from "wouter";
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
import { API_BASE } from "@/lib/api-base";
import { Plus, Pencil, Trash2, Loader2, BookOpen, Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getListPrestationsQueryKey } from "@workspace/api-client-react";


// Types
interface Catalog {
    id: number;
    name: string;
    createdAt: string;
}

const catalogSchema = z.object({
    name: z.string().min(1, "Le nom est requis"),
});

type CatalogFormValues = z.infer<typeof catalogSchema>;

const BASE = API_BASE;

export function Formations() {
    const { user, isLoading: isAuthLoading } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const isAdmin = user?.role === "admin";

    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Catalog | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [searchTerm, setSearchTerm] = useState("");

    // Fetch API
    const { data: items = [], isLoading } = useQuery<Catalog[]>({
        queryKey: ["catalogs"],
        queryFn: async () => {
            const res = await fetch(`${BASE}/api/catalogs`, { credentials: "include" });
            if (!res.ok) throw new Error("Erreur de chargement");
            return res.json();
        },
        enabled: !!user,
    });

    const orderedItems = [...items]
        .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));

    const createMutation = useMutation({
        mutationFn: async (data: CatalogFormValues) => {
            const res = await fetch(`${BASE}/api/catalogs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => null);
                throw new Error(j?.error || "Erreur lors de la création");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["catalogs"] });
            queryClient.invalidateQueries({ queryKey: getListPrestationsQueryKey() });
            setIsFormOpen(false);
            toast({ title: "Formation ajoutée" });
        },
        onError: (err) => {
            toast({ variant: "destructive", title: "Création impossible", description: err instanceof Error ? err.message : "Erreur" });
        },
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, data }: { id: number; data: CatalogFormValues }) => {
            const res = await fetch(`${BASE}/api/catalogs/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => null);
                throw new Error(j?.error || "Erreur lors de la mise à jour");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["catalogs"] });
            queryClient.invalidateQueries({ queryKey: getListPrestationsQueryKey() });
            setIsFormOpen(false);
            toast({ title: "Formation mise à jour" });
        },
        onError: (err) => {
            toast({ variant: "destructive", title: "Mise à jour impossible", description: err instanceof Error ? err.message : "Erreur" });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetch(`${BASE}/api/catalogs/${id}`, { method: "DELETE", credentials: "include" });
            if (!res.ok) {
                const j = await res.json().catch(() => null);
                throw new Error(j?.error || "Erreur lors de la suppression");
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["catalogs"] });
            queryClient.invalidateQueries({ queryKey: getListPrestationsQueryKey() });
            setDeletingId(null);
            toast({ title: "Formation supprimée" });
        },
        onError: (err) => {
            toast({ variant: "destructive", title: "Suppression impossible", description: err instanceof Error ? err.message : "Erreur" });
        },
    });

    const form = useForm<CatalogFormValues>({
        resolver: zodResolver(catalogSchema),
        defaultValues: { name: "" },
    });

    const openCreate = () => {
        setEditingItem(null);
        form.reset({ name: "" });
        setIsFormOpen(true);
    };

    const openEdit = (item: Catalog) => {
        setEditingItem(item);
        form.reset({
            name: item.name,
        });
        setIsFormOpen(true);
    };

    const onSubmit = (values: CatalogFormValues) => {
        if (editingItem) {
            updateMutation.mutate({ id: editingItem.id, data: values });
        } else {
            createMutation.mutate(values);
        }
    };

    if (isAuthLoading) return null;
    if (!user) return <Redirect to="/" />;

    const filteredItems = orderedItems.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <Layout>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Formations</h1>
                    <p className="text-slate-500 mt-1 max-w-2xl">
                        Liste officielle synchronisée avec le champ <span className="font-medium">Prestation / Formation</span> dans la facture.
                    </p>
                </div>
                {isAdmin && (
                    <Button onClick={openCreate} className="bg-indigo-600 hover:bg-indigo-700">
                        <Plus className="h-4 w-4 mr-2" /> Nouvelle Formation
                    </Button>
                )}
            </div>

            <h2 className="text-lg font-semibold text-slate-900 mb-3">Catalogue</h2>
            <div className="mb-6 relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input 
                    placeholder="Rechercher une formation..." 
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {isLoading ? (
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-slate-400">
                    <BookOpen className="h-12 w-12 mb-4 opacity-30" />
                    <p className="text-lg">{searchTerm ? "Aucun résultat trouvé" : "Aucune formation dans la liste"}</p>
                    {!searchTerm && (
                        <Button className="mt-4" variant="outline" onClick={openCreate}>
                            Ajouter la première formation
                        </Button>
                    )}
                </div>
            ) : (
                <figure className="m-0 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                    <table className="w-full min-w-[28rem] border-collapse text-sm">
                        <caption className="sr-only">Liste des formations enregistrées</caption>
                        <thead>
                            <tr className="border-b bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wide">
                                <th scope="col" className="px-4 py-3 text-left">Formation</th>
                                <th scope="col" className="px-4 py-3 text-left w-40">Ajoutée le</th>
                                {isAdmin && <th scope="col" className="px-4 py-3 text-center w-28">Actions</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredItems.map((item) => (
                                <tr
                                    key={item.id}
                                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80 transition-colors"
                                >
                                    <th scope="row" className="px-4 py-3 text-left font-medium text-slate-900">
                                        <span className="inline-flex max-w-xl min-w-0 items-center gap-2">
                                            <BookOpen className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden />
                                            <span className="truncate">{item.name}</span>
                                        </span>
                                    </th>
                                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                                        {new Date(item.createdAt).toLocaleDateString("fr-FR", {
                                            day: "numeric",
                                            month: "short",
                                            year: "numeric",
                                        })}
                                    </td>
                                    {isAdmin && (
                                        <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 mr-1" onClick={() => openEdit(item)} type="button" title="Modifier">
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => setDeletingId(item.id)} type="button" title="Supprimer">
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

            {/* Dialog Form */}
            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingItem ? "Modifier la formation" : "Ajouter une formation"}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Formation / prestation *</Label>
                            <Input id="name" {...form.register("name")} placeholder="Ex: Habilitation électrique" />
                            {form.formState.errors.name && <p className="text-xs text-red-500">{form.formState.errors.name.message}</p>}
                        </div>

                        <DialogFooter className="pt-2">
                            <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annuler</Button>
                            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700">
                                {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : (editingItem ? "Mettre à jour" : "Ajouter")}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Delete confirmation */}
            <AlertDialog open={deletingId !== null} onOpenChange={() => setDeletingId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer cette formation ?</AlertDialogTitle>
                        <AlertDialogDescription>Le titre sera définitivement supprimé de la liste.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deletingId && deleteMutation.mutate(deletingId)}>
                            Supprimer
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Layout>
    );
}

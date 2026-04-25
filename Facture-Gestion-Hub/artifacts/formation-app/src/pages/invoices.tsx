import { useState, useRef } from "react";
import { Redirect } from "wouter";
import {
  useListInvoices,
  getListInvoicesQueryKey,
  useCreateInvoice,
  useUpdateInvoice,
  useDeleteInvoice,
  useListClients,
  getListClientsQueryKey,
  useCreateClient,
  useGetNextNumeroFacture,
  getGetNextNumeroFactureQueryKey,
} from "@workspace/api-client-react";
import type { Invoice, Client } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { API_BASE } from "@/lib/api-base";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Loader2, FileText, Filter, Upload,
  ChevronUp, ChevronDown, ChevronsUpDown, Check, Wand2, Calendar as CalendarIcon, Calendar, Download, Printer, FileSpreadsheet,
} from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import * as XLSX from "xlsx-js-style";

type Statut = "paye" | "en_attente";
type Trimestre = "T1" | "T2" | "T3" | "T4";

import { format, isSameMonth, isSameYear } from "date-fns";
import { fr } from "date-fns/locale";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { DateRange } from "react-day-picker";

const MOROCCAN_CITIES = [
  "Agadir", "Al Hoceïma", "Béni Mellal", "Berkane", "Berrechid",
  "Casablanca", "Dakhla", "El Jadida", "Errachidia", "Essaouira",
  "Fès", "Guelmim", "Ifrane", "Kénitra", "Khemisset", "Khouribga",
  "Laâyoune", "Larache", "Marrakech", "Meknès", "Mohammedia",
  "Nador", "Ouarzazate", "Oujda", "Rabat", "Safi",
  "Salé", "Settat", "Sidi Ifni", "Tanger", "Taroudant",
  "Taza", "Tétouan", "Tiznit",
];

const quickClientSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  city: z.string().nullable().optional(),
  ice: z.string().nullable().optional(),
});
type QuickClientFormValues = z.infer<typeof quickClientSchema>;

const invoiceSchema = z.object({
  numeroFacture: z.string().min(1, "Requis"),
  trimestre: z.enum(["T1", "T2", "T3", "T4"]),
  year: z.coerce.number().int().min(2000).max(2100),
  dateFormation: z.string().nullable().optional(),
  dateFacture: z.string().nullable().optional(),
  clientId: z.number().nullable().optional(),
  cabinet: z.string().nullable().optional(),
  ville: z.string().nullable().optional(),
  prestation: z.string().min(1, "Requis"),
  montantDh: z.coerce.number().positive("Montant requis"),
  modePaiement: z.enum(["virement", "cheque", "espece"]).nullable().optional(),
  numeroPaiement: z.string().nullable().optional(),
  datePaiement: z.string().nullable().optional(),
  statut: z.enum(["paye", "en_attente"]),
  dateDeclaration: z.string().nullable().optional(),
  invoiceDocxUrl: z.string().nullable().optional(),
});

type InvoiceFormValues = z.infer<typeof invoiceSchema>;

const STATUT_LABELS: Record<Statut, string> = {
  paye: "Payée",
  en_attente: "En attente",
};

const STATUT_COLORS: Record<Statut, string> = {
  paye: "bg-emerald-100 text-emerald-800 border-emerald-200",
  en_attente: "bg-amber-100 text-amber-800 border-amber-200",
};

function normalizeStatut(value: string | null | undefined): Statut {
  if (value === "paye" || value === "regle") return "paye";
  return "en_attente";
}

const TRIMESTRE_COLORS: Record<Trimestre, string> = {
  T1: "bg-blue-50",
  T2: "bg-emerald-50",
  T3: "bg-yellow-50",
  T4: "bg-purple-50",
};

const BASE = API_BASE;
const currentYear = new Date().getFullYear();
const IMPOTS_RATE = 0.01;

function getAutoTrimestre(): Trimestre {
  const month = new Date().getMonth() + 1;
  if (month >= 1 && month <= 3) return "T1";
  if (month >= 4 && month <= 6) return "T2";
  if (month >= 7 && month <= 9) return "T3";
  return "T4";
}

function inferUploadContentType(file: File): string {
  if (file.type) return file.type;
  if (file.name.toLowerCase().endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}

async function requestUploadUrl(file: File): Promise<{ uploadURL: string; objectPath: string }> {
  const res = await fetch(`${BASE}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: inferUploadContentType(file),
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string; uploadURL?: string; objectPath?: string };
  if (!res.ok) {
    throw new Error(payload.error || `Impossible d'obtenir l'URL d'upload (${res.status})`);
  }
  if (!payload.uploadURL || !payload.objectPath) {
    throw new Error("Réponse serveur invalide pour l'upload");
  }
  return { uploadURL: payload.uploadURL, objectPath: payload.objectPath };
}

async function uploadToGcs(file: File, uploadURL: string): Promise<void> {
  const baseOrigin = (() => {
    try {
      return new URL(BASE || window.location.origin).origin;
    } catch {
      return window.location.origin;
    }
  })();

  const absolute =
    uploadURL.startsWith("http://") || uploadURL.startsWith("https://")
      ? uploadURL
      : new URL(uploadURL, baseOrigin).href;

  // When uploading to our API (HF), we need cookies (session). When uploading to a
  // presigned third-party URL (e.g. GCS), we must omit credentials.
  const isThirdParty =
    absolute.startsWith("http") && new URL(absolute).origin !== baseOrigin;
  const res = await fetch(absolute, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": inferUploadContentType(file) },
    credentials: isThirdParty ? "omit" : "include",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || "Échec de l'envoi du fichier vers le stockage");
  }
}

function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

function hasDocxUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.trim().length > 0;
}

function docxDownloadFilename(docxUrl: string): string {
  try {
    const u = new URL(docxUrl, window.location.origin);
    const q = u.searchParams.get("filename");
    if (q) return q;
  } catch {
    /* relative URL */
  }
  const idx = docxUrl.indexOf("filename=");
  if (idx !== -1) {
    const raw = docxUrl.slice(idx + "filename=".length).split("&")[0];
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw || "facture.docx";
    }
  }
  return "facture.docx";
}

async function downloadDocxAuthenticated(url: string, filename: string): Promise<void> {
  const absolute =
    url.startsWith("http://") || url.startsWith("https://")
      ? url
      : new URL(url, window.location.origin).href;
  const res = await fetch(absolute, { credentials: "include" });
  if (!res.ok) {
    throw new Error(res.status === 401 ? "Session expirée — reconnectez-vous" : "Impossible de télécharger le fichier");
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export function Invoices() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const docxInputRef = useRef<HTMLInputElement>(null);

  type SortKey = "dateFormation" | "dateFacture" | "numeroFacture" | "montantDh" | "statut" | "trimestre";
  type SortDir = "asc" | "desc";

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [filterTrimestre, setFilterTrimestre] = useState<string>("all");
  const [filterStatut, setFilterStatut] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("dateFormation");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [openPrestation, setOpenPrestation] = useState(false);
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const [villeIsCustom, setVilleIsCustom] = useState(false);
  const [downloadingFacId, setDownloadingFacId] = useState<number | null>(null);
  const [isDownloadingFormDocx, setIsDownloadingFormDocx] = useState(false);

  const handlePrintPage = () => {
    window.print();
  };

  const handleExportExcel = () => {
    const applyRowBackground = (ws: Record<string, any>, rowIndex: number, colorHexNoHash: string) => {
      for (let colIndex = 0; colIndex < headers.length; colIndex += 1) {
        const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const cell = ws[cellAddress];
        if (!cell) continue;
        cell.s = {
          ...(cell.s || {}),
          fill: {
            patternType: "solid",
            fgColor: { rgb: colorHexNoHash },
          },
        };
      }
    };

    const headers = [
      "Trimestre",
      "Date formation",
      "Date facture",
      "N° Facture",
      "Cabinet",
      "Client",
      "Ville",
      "Prestation",
      "Montant DH",
      "Mode de paiement",
      "Numéro de virement",
      "Date de paiement",
      "Statut",
      "Date Déclaration",
      "Impôt à payer",
      "Tranche CNSS",
    ];

    const rows = invoices.map((inv) => {
      const montant = Number.isFinite(Number(inv.montantDh)) ? Number(inv.montantDh) : 0;
      const impot = inv.impotAPayer ?? montant * IMPOTS_RATE;
      const cnss = inv.cnss ?? montant * 0.031;
      return [
        inv.trimestre ?? "",
        inv.dateFormation ?? "",
        inv.dateFacture ?? "",
        inv.numeroFacture ?? "",
        inv.cabinet ?? "",
        inv.clientName ?? "",
        inv.ville ?? "",
        inv.prestation ?? "",
        formatDHSmall(montant),
        inv.modePaiement ?? "",
        inv.numeroPaiement ?? "",
        inv.datePaiement ?? "",
        STATUT_LABELS[inv.statut as Statut] ?? inv.statut ?? "",
        inv.dateDeclaration ?? "",
        formatDHSmall(impot),
        formatDHSmall(cnss),
      ];
    });

    const totalMontant = invoices.reduce((sum, inv) => sum + Number(inv.montantDh || 0), 0);
    const totalImpot = invoices.reduce((sum, inv) => sum + (inv.impotAPayer ?? Number(inv.montantDh) * IMPOTS_RATE), 0);
    const totalCnss = invoices.reduce((sum, inv) => sum + (inv.cnss ?? Number(inv.montantDh) * 0.031), 0);

    const titleRow = ["Registre des Factures"];
    const metaRow = [`${invoices.length} facture(s) exportée(s)`];
    const totalRow = [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "TOTAL",
      formatDH(totalMontant),
      "",
      "",
      "",
      "",
      "",
      formatDHSmall(totalImpot),
      formatDHSmall(totalCnss),
    ];

    const sheetData = [titleRow, metaRow, [], headers, ...rows, totalRow];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws["!cols"] = [
      { wch: 10 }, // Trimestre
      { wch: 16 }, // Date formation
      { wch: 14 }, // Date facture
      { wch: 12 }, // N° facture
      { wch: 18 }, // Cabinet
      { wch: 18 }, // Client
      { wch: 14 }, // Ville
      { wch: 36 }, // Prestation
      { wch: 14 }, // Montant
      { wch: 16 }, // Mode paiement
      { wch: 20 }, // N° virement
      { wch: 14 }, // Date paiement
      { wch: 12 }, // Statut
      { wch: 16 }, // Date declaration
      { wch: 14 }, // Impot
      { wch: 14 }, // CNSS
    ];

    // Header row style (requested: #d0d0d0)
    const headerRowIndex = 3;
    applyRowBackground(ws as Record<string, any>, headerRowIndex, "D0D0D0");

    // Data rows by status:
    // - payé: #ffff00
    // - en attente: #f9e2d5
    const dataRowStartIndex = headerRowIndex + 1;
    invoices.forEach((inv, i) => {
      const normalized = normalizeStatut(inv.statut);
      const color = normalized === "paye" ? "FFFF00" : "F9E2D5";
      applyRowBackground(ws as Record<string, any>, dataRowStartIndex + i, color);
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Factures");
    const stamp = format(new Date(), "yyyy-MM-dd_HH-mm-ss");
    const wbArray = XLSX.write(wb, {
      bookType: "xlsx",
      type: "array",
      compression: true,
    });
    const blob = new Blob([wbArray], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices_${stamp}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadFac = async (invoiceId: number, docxUrl: string) => {
    const name = docxDownloadFilename(docxUrl);
    setDownloadingFacId(invoiceId);
    try {
      await downloadDocxAuthenticated(docxUrl, name);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Téléchargement impossible",
        description: err instanceof Error ? err.message : "Réessayez depuis le formulaire de la facture.",
      });
    } finally {
      setDownloadingFacId(null);
    }
  };

  const handleDownloadFormDocx = async () => {
    const u = form.getValues("invoiceDocxUrl");
    if (!u?.trim()) return;
    setIsDownloadingFormDocx(true);
    try {
      await downloadDocxAuthenticated(u.trim(), docxDownloadFilename(u.trim()));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Téléchargement impossible",
        description: err instanceof Error ? err.message : "Erreur",
      });
    } finally {
      setIsDownloadingFormDocx(false);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const params: { year?: number; trimestre?: string; statut?: string } = { year: selectedYear };
  if (filterTrimestre !== "all") params.trimestre = filterTrimestre;
  if (filterStatut !== "all") params.statut = filterStatut;

  const { data: invoicesRaw = [], isLoading } = useListInvoices(params, {
    query: {
      queryKey: getListInvoicesQueryKey(params),
      enabled: !!user,
    },
  });

  const invoices = [...invoicesRaw].sort((a, b) => {
    const cmp = (() => {
      if (sortKey === "montantDh") return Number(a.montantDh) - Number(b.montantDh);
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      return String(av).localeCompare(String(bv));
    })();
    return sortDir === "asc" ? cmp : -cmp;
  });

  const { data: clients = [] } = useListClients({
    query: { queryKey: getListClientsQueryKey(), enabled: !!user },
  });

  const { data: nextNumero } = useGetNextNumeroFacture({
    query: { queryKey: getGetNextNumeroFactureQueryKey(), enabled: !!user && !editingInvoice },
  });

  const { data: catalogs = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["catalogs"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/catalogs`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur");
      return res.json();
    },
    enabled: !!user,
  });

  const createInvoice = useCreateInvoice();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const createClient = useCreateClient();

  const quickClientForm = useForm<QuickClientFormValues>({
    resolver: zodResolver(quickClientSchema),
    defaultValues: { name: "", city: "", ice: "" },
  });

  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      numeroFacture: "",
      trimestre: "T1",
      year: currentYear,
      prestation: "",
      montantDh: 0,
      statut: "en_attente",
      invoiceDocxUrl: "",
    },
  });

  const openCreate = () => {
    setEditingInvoice(null);
    setAutoFilledFields(new Set());
    setVilleIsCustom(false);
    form.reset({
      numeroFacture: nextNumero?.numeroFacture ?? "",
      trimestre: getAutoTrimestre(),
      year: currentYear,
      prestation: "",
      montantDh: 0,
      statut: "en_attente",
      invoiceDocxUrl: "",
    });
    setIsFormOpen(true);
  };

  const openEdit = (inv: Invoice) => {
    setEditingInvoice(inv);
    setAutoFilledFields(new Set());
    setVilleIsCustom(!!inv.ville && !MOROCCAN_CITIES.includes(inv.ville));
    form.reset({
      numeroFacture: inv.numeroFacture,
      trimestre: inv.trimestre,
      year: inv.year,
      dateFormation: inv.dateFormation ?? "",
      dateFacture: inv.dateFacture ?? "",
      clientId: inv.clientId ?? undefined,
      cabinet: inv.cabinet ?? "",
      ville: inv.ville ?? "",
      prestation: inv.prestation,
      montantDh: inv.montantDh,
      modePaiement: inv.modePaiement ?? undefined,
      numeroPaiement: inv.numeroPaiement ?? "",
      datePaiement: inv.datePaiement ?? "",
      statut: normalizeStatut(inv.statut),
      dateDeclaration: inv.dateDeclaration ?? "",
      invoiceDocxUrl: inv.invoiceDocxUrl ?? "",
    });
    setIsFormOpen(true);
  };

  const clearAutoFill = (field: string) => {
    setAutoFilledFields(prev => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  const parseDocxAndFill = async (file: File) => {
    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${BASE}/api/invoices/parse-docx`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Session expirée — reconnectez-vous");
        }
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Erreur lors de la lecture du document");
      }
      const data = await res.json() as {
        numeroFacture?: string | null;
        dateFacture?: string | null;
        cabinet?: string | null;
        clientId?: number | null;
        prestation?: string | null;
        prestations?: string[];
        dateFormation?: string | null;
        montantDh?: number | null;
      };
      const filled = new Set<string>();
      if (data.numeroFacture) { form.setValue("numeroFacture", data.numeroFacture); filled.add("numeroFacture"); }
      if (data.dateFacture) { form.setValue("dateFacture", data.dateFacture); filled.add("dateFacture"); }
      if (data.cabinet) { form.setValue("cabinet", data.cabinet); filled.add("cabinet"); }
      const prestationText = data.prestations && data.prestations.length > 0
        ? data.prestations.join("\n")
        : data.prestation ?? null;
      if (prestationText) { form.setValue("prestation", prestationText); filled.add("prestation"); }
      if (data.dateFormation) { form.setValue("dateFormation", data.dateFormation); filled.add("dateFormation"); }
      if (data.montantDh) { form.setValue("montantDh", data.montantDh); filled.add("montantDh"); }
      if (data.clientId) { form.setValue("clientId", data.clientId); filled.add("clientId"); }
      setAutoFilledFields(filled);

      try {
        const { uploadURL, objectPath } = await requestUploadUrl(file);
        await uploadToGcs(file, uploadURL);
        const storedUrl = `${BASE}/api/storage${objectPath}?filename=${encodeURIComponent(file.name)}`;
        form.setValue("invoiceDocxUrl", storedUrl, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
        toast({
          title: "Word enregistré",
          description: `${filled.size} champ(s) prérempli(s). Enregistrez la facture : la colonne Facture affichera Télécharger.`,
        });
      } catch (uploadErr) {
        toast({
          variant: "destructive",
          title: "Le Word n'a pas pu être stocké",
          description:
            uploadErr instanceof Error
              ? uploadErr.message
              : "Sans stockage, la colonne Facture restera vide après enregistrement. Vérifiez la configuration du stockage.",
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Échec de l'importation",
        description: err instanceof Error ? err.message : "Erreur inconnue",
      });
    } finally {
      setIsParsing(false);
      if (docxInputRef.current) docxInputRef.current.value = "";
    }
  };

  const onSubmitQuickClient = (values: QuickClientFormValues) => {
    createClient.mutate(
      { data: { name: values.name, city: values.city || null, ice: values.ice || null, contact: null, phone: null } },
      {
        onSuccess: (newClient) => {
          // Immediately add new client to cache so the Select can show it right away
          queryClient.setQueryData<Client[]>(getListClientsQueryKey(), (old = []) => [...old, newClient]);
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          form.setValue("clientId", newClient.id);
          setAutoFilledFields(prev => new Set([...prev, "clientId"]));
          setIsQuickAddClientOpen(false);
          toast({ title: "Cabinet ajouté", description: newClient.name });
        },
        onError: () => toast({ variant: "destructive", title: "Erreur lors de la création du cabinet" }),
      }
    );
  };

  const onSubmit = (values: InvoiceFormValues) => {
    const data = {
      ...values,
      dateFormation: values.dateFormation || null,
      dateFacture: values.dateFacture || null,
      clientId: values.clientId || null,
      cabinet: values.cabinet || null,
      ville: values.ville || null,
      modePaiement: values.modePaiement || null,
      numeroPaiement: values.numeroPaiement || null,
      datePaiement: values.datePaiement || null,
      dateDeclaration: values.dateDeclaration || null,
      invoiceFileUrl: editingInvoice ? editingInvoice.invoiceFileUrl ?? null : null,
      invoiceDocxUrl: (typeof values.invoiceDocxUrl === "string" && values.invoiceDocxUrl.trim() !== "")
        ? values.invoiceDocxUrl.trim()
        : null,
    };

    const afterInvoiceSaved = async () => {
      await queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: ["catalogs"] });
    };

    if (editingInvoice) {
      updateInvoice.mutate(
        { id: editingInvoice.id, data },
        {
          onSuccess: async () => {
            await afterInvoiceSaved();
            setIsFormOpen(false);
            toast({ title: "Facture mise à jour" });
          },
          onError: () => toast({ variant: "destructive", title: "Erreur lors de la mise à jour" }),
        }
      );
    } else {
      createInvoice.mutate(
        { data },
        {
          onSuccess: async () => {
            await afterInvoiceSaved();
            queryClient.invalidateQueries({ queryKey: getGetNextNumeroFactureQueryKey() });
            setIsFormOpen(false);
            toast({ title: "Facture créée" });
          },
          onError: () => toast({ variant: "destructive", title: "Erreur lors de la création" }),
        }
      );
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteInvoice.mutate(
      { id: deletingId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          setDeletingId(null);
          toast({ title: "Facture supprimée" });
        },
        onError: () => toast({ variant: "destructive", title: "Erreur lors de la suppression" }),
      }
    );
  };

  const formatDH = (amount: number) =>
    new Intl.NumberFormat("fr-MA", {
      style: "currency",
      currency: "MAD",
      maximumFractionDigits: 0,
    }).format(amount);

  const formatDHSmall = (amount: number) =>
    new Intl.NumberFormat("fr-MA", {
      style: "currency",
      currency: "MAD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);

  const afClass = (field: string) =>
    autoFilledFields.has(field) ? "border-amber-400 bg-amber-50 ring-1 ring-amber-300" : "";

  if (isAuthLoading) return null;
  if (!user) return <Redirect to="/" />;

  const totalCols = isAdmin ? 18 : 17;

  return (
    <Layout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Registre des Factures</h1>
          <p className="text-slate-500 mt-1">{invoices.length} factures enregistrées</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button type="button" variant="outline" onClick={handleExportExcel} data-testid="btn-export-excel">
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
          </Button>
          <Button type="button" variant="outline" onClick={handlePrintPage} data-testid="btn-print-invoices">
            <Printer className="h-4 w-4 mr-2" /> Imprimer / Exporter
          </Button>
          {isAdmin && (
            <Button onClick={openCreate} data-testid="btn-add-invoice">
              <Plus className="h-4 w-4 mr-2" /> Nouvelle Facture
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6 items-center print:hidden">
        <Filter className="h-4 w-4 text-slate-400" />
        <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
          <SelectTrigger className="w-28" data-testid="select-year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((y) => (
              <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterTrimestre} onValueChange={setFilterTrimestre}>
          <SelectTrigger className="w-36" data-testid="select-trimestre">
            <SelectValue placeholder="Trimestre" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous trimestres</SelectItem>
            <SelectItem value="T1">T1</SelectItem>
            <SelectItem value="T2">T2</SelectItem>
            <SelectItem value="T3">T3</SelectItem>
            <SelectItem value="T4">T4</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterStatut} onValueChange={setFilterStatut}>
          <SelectTrigger className="w-36" data-testid="select-statut">
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="paye">Payé</SelectItem>
            <SelectItem value="en_attente">En attente</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="rounded-lg border overflow-auto bg-white shadow-sm print:overflow-visible print:border-0 print:rounded-none print:shadow-none">
          <table className="w-full text-sm print:text-[10px] print:table-auto" data-testid="invoices-table">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wide">
                {(["trimestre", "dateFormation", "dateFacture", "numeroFacture"] as const).map((col) => {
                  const labels: Record<string, string> = {
                    trimestre: "Trimestre",
                    dateFormation: "Date formation",
                    dateFacture: "Date facture",
                    numeroFacture: "N° Facture",
                  };
                  const isSorted = sortKey === col;
                  return (
                    <th
                      key={col}
                      className="px-3 py-3 text-left cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => handleSort(col)}
                      data-testid={`th-sort-${col}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {labels[col]}
                        {isSorted ? (
                          sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </span>
                    </th>
                  );
                })}
                <th className="px-3 py-3 text-left">Cabinet</th>
                <th className="px-3 py-3 text-left">Client</th>
                <th className="px-3 py-3 text-left">ville</th>
                <th className="px-3 py-3 text-left">Prestation</th>
                <th
                  className="px-3 py-3 text-right cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => handleSort("montantDh")}
                  data-testid="th-sort-montantDh"
                >
                  <span className="inline-flex items-center gap-1 ml-auto">
                    Montant DH
                    {sortKey === "montantDh" ? (
                      sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronsUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </span>
                </th>
                <th className="px-3 py-3 text-left">Mode de paiement</th>
                <th className="px-3 py-3 text-left">Numéro de virement</th>
                <th className="px-3 py-3 text-left">Date de paiement</th>
                <th
                  className="px-3 py-3 text-left cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => handleSort("statut")}
                  data-testid="th-sort-statut"
                >
                  <span className="inline-flex items-center gap-1">
                    Statut
                    {sortKey === "statut" ? (
                      sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronsUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </span>
                </th>
                <th className="px-3 py-3 text-left">Date Déclaration</th>
                <th className="px-3 py-3 text-right text-indigo-700">impôt à payer</th>
                <th className="px-3 py-3 text-right text-emerald-700">Tranche CNSS</th>
                <th className="px-3 py-3 text-center" title="Document Word (.docx)">
                  Facture
                </th>
                {isAdmin && <th className="px-3 py-3 text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="px-4 py-16 text-center text-slate-400">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    Aucune facture pour cette période
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => {
                  const montant = Number.isFinite(Number(inv.montantDh)) ? Number(inv.montantDh) : 0;
                  const impot = inv.impotAPayer ?? montant * IMPOTS_RATE;
                  return (
                    <tr
                      key={inv.id}
                      className={`border-b last:border-0 hover:brightness-95 transition-all ${TRIMESTRE_COLORS[inv.trimestre as Trimestre] ?? ""}`}
                      data-testid={`row-invoice-${inv.id}`}
                    >
                      <td className="px-3 py-2 font-semibold text-xs text-slate-500">{inv.trimestre}</td>
                      <td className="px-3 py-2 whitespace-nowrap print:whitespace-normal text-xs">{inv.dateFormation ?? "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap print:whitespace-normal text-xs">{inv.dateFacture ?? "-"}</td>
                      <td className="px-3 py-2 font-mono font-medium">{inv.numeroFacture}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-xs">{inv.clientName ?? "-"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-xs text-indigo-600">{inv.cabinet?.trim() ? inv.cabinet : "-"}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600 text-xs">{inv.ville ?? "-"}</td>
                      <td className="px-3 py-2 max-w-48 print:max-w-none">
                        <div className="whitespace-pre-line text-[10px] leading-tight">{inv.prestation}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">{formatDH(montant)}</td>
                      <td className="px-3 py-2 capitalize text-xs text-slate-600">{inv.modePaiement ?? "-"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500 max-w-32 truncate print:max-w-none print:whitespace-normal print:overflow-visible print:text-clip">{inv.numeroPaiement ?? "-"}</td>
                      <td className="px-3 py-2 text-xs">{inv.datePaiement ?? "-"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border uppercase ${STATUT_COLORS[inv.statut as Statut] ?? ""}`}
                          data-testid={`badge-statut-${inv.id}`}
                        >
                          {STATUT_LABELS[inv.statut as Statut] ?? inv.statut}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{inv.dateDeclaration ?? "-"}</td>
                      <td className="px-3 py-2 text-right text-xs text-indigo-700 font-bold" data-testid={`impot-${inv.id}`}>
                        {formatDHSmall(impot)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-emerald-700 font-bold" data-testid={`cnss-${inv.id}`}>
                        {formatDHSmall(inv.cnss ?? montant * 0.031)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {hasDocxUrl(inv.invoiceDocxUrl) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 px-2 gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50"
                            disabled={downloadingFacId === inv.id}
                            title={`Télécharger ${docxDownloadFilename(inv.invoiceDocxUrl)}`}
                            data-testid={`btn-fac-docx-${inv.id}`}
                            onClick={() => {
                              const u = inv.invoiceDocxUrl;
                              if (u) void handleDownloadFac(inv.id, u);
                            }}
                          >
                            {downloadingFacId === inv.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            <span className="text-[11px] font-semibold">Télécharger</span>
                          </Button>
                        ) : (
                          <span className="text-slate-300 text-[10px] font-medium">—</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2">
                          <div className="flex gap-1 justify-center">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => openEdit(inv)}
                              data-testid={`btn-edit-invoice-${inv.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => setDeletingId(inv.id)}
                              data-testid={`btn-delete-invoice-${inv.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            {invoices.length > 0 && (
              <tfoot>
                <tr className="border-t bg-slate-50 font-semibold">
                  <td colSpan={8} className="px-3 py-2 text-right text-sm text-slate-600">
                    Total ({invoices.length} factures):
                  </td>
                  <td className="px-3 py-2 text-right text-sm">
                    {formatDH(invoices.reduce((sum, inv) => sum + Number(inv.montantDh), 0))}
                  </td>
                  <td colSpan={5} />
                  <td className="px-3 py-2 text-right text-xs text-indigo-700 font-bold">
                    {formatDHSmall(invoices.reduce((sum, inv) => sum + (inv.impotAPayer ?? Number(inv.montantDh) * IMPOTS_RATE), 0))}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-emerald-700 font-bold">
                    {formatDHSmall(invoices.reduce((sum, inv) => sum + (inv.cnss ?? Number(inv.montantDh) * 0.031), 0))}
                  </td>
                  <td className="px-3 py-2" />
                  {isAdmin && <td className="px-3 py-2" />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl max-h-screen overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingInvoice ? "Modifier la facture" : "Nouvelle facture"}</DialogTitle>
          </DialogHeader>

          {autoFilledFields.size > 0 && (
            <p className="text-xs text-amber-700 flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 shrink-0" />
              Les champs surlignés ont été remplis automatiquement — vérifiez-les avant de soumettre.
            </p>
          )}

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="numeroFacture">N° Facture *</Label>
                <Input
                  id="numeroFacture"
                  {...form.register("numeroFacture", { onChange: () => clearAutoFill("numeroFacture") })}
                  className={afClass("numeroFacture")}
                  data-testid="input-numero-facture"
                  placeholder="Ex: 01/2025"
                />
                {form.formState.errors.numeroFacture && (
                  <p className="text-xs text-red-500 mt-1">{form.formState.errors.numeroFacture.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="year">Année *</Label>
                <Input id="year" type="number" {...form.register("year")} data-testid="input-year" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Trimestre *</Label>
                <Controller
                  name="trimestre"
                  control={form.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger data-testid="select-form-trimestre">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="T1">T1 (Jan-Mar)</SelectItem>
                        <SelectItem value="T2">T2 (Avr-Jun)</SelectItem>
                        <SelectItem value="T3">T3 (Jul-Sep)</SelectItem>
                        <SelectItem value="T4">T4 (Oct-Déc)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div>
                <Label>Statut *</Label>
                <Controller
                  name="statut"
                  control={form.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger data-testid="select-form-statut">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en_attente">En attente</SelectItem>
                        <SelectItem value="paye">Payé</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dateFormation">Date formation</Label>
                <div className="flex gap-2">
                  <Input
                    id="dateFormation"
                    {...form.register("dateFormation", { onChange: () => clearAutoFill("dateFormation") })}
                    className={cn(afClass("dateFormation"), "flex-1")}
                    placeholder="Ex: 21-24/04/2026"
                    data-testid="input-date-formation"
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="icon" className="shrink-0 h-9 w-9 bg-indigo-50 border-indigo-200" data-testid="btn-calendar-formation">
                        <CalendarIcon className="h-4 w-4 text-indigo-600" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <CalendarComponent
                        mode="range"
                        selected={(() => {
                          const val = form.watch("dateFormation");
                          if (!val) return undefined;
                          // Basic parser for "DD-DD/MM/YYYY" or "DD/MM-DD/MM/YYYY"
                          try {
                            if (val.includes("-")) {
                              const [startPart, endPart] = val.split("-");
                              let from: Date, to: Date;
                              if (endPart.includes("/")) {
                                const [d1, m1, y1] = endPart.split("/");
                                to = new Date(parseInt(y1), parseInt(m1) - 1, parseInt(d1));
                                if (startPart.includes("/")) {
                                  const [d0, m0] = startPart.split("/");
                                  from = new Date(parseInt(y1), parseInt(m0) - 1, parseInt(d0));
                                } else {
                                  from = new Date(parseInt(y1), parseInt(m1) - 1, parseInt(startPart));
                                }
                                return { from, to };
                              }
                            } else if (val.includes("/")) {
                              const [d, m, y] = val.split("/");
                              const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
                              return { from: date, to: date };
                            }
                          } catch (e) { /* ignore parse error */ }
                          return undefined;
                        })()}
                        onSelect={(range: DateRange | undefined) => {
                          if (range?.from) {
                            let val = format(range.from, "dd/MM/yyyy");
                            if (range.to) {
                              if (isSameMonth(range.from, range.to) && isSameYear(range.from, range.to)) {
                                val = `${format(range.from, "dd")}-${format(range.to, "dd")}/${format(range.from, "MM/yyyy")}`;
                              } else {
                                val = `${format(range.from, "dd/MM")}-${format(range.to, "dd/MM/yyyy")}`;
                              }
                            }
                            form.setValue("dateFormation", val, { shouldDirty: true, shouldValidate: true });
                            clearAutoFill("dateFormation");
                          }
                        }}
                        initialFocus
                        locale={fr}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div>
                <Label htmlFor="dateFacture">Date facture</Label>
                <div className="flex gap-2">
                  <Input
                    id="dateFacture"
                    {...form.register("dateFacture", { onChange: () => clearAutoFill("dateFacture") })}
                    className={cn(afClass("dateFacture"), "flex-1")}
                    placeholder="Ex: 05/02/2025"
                    data-testid="input-date-facture"
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="icon" className="shrink-0 h-9 w-9">
                        <CalendarIcon className="h-4 w-4 text-slate-500" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <CalendarComponent
                        mode="single"
                        onSelect={(date) => {
                          if (date) {
                            form.setValue("dateFacture", format(date, "dd/MM/yyyy"));
                            clearAutoFill("dateFacture");
                          }
                        }}
                        initialFocus
                        locale={fr}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label>Cabinet / Organisateur</Label>
                <Controller
                  name="clientId"
                  control={form.control}
                  render={({ field }) => (
                    <Select
                      key={String(field.value ?? "none")}
                      onValueChange={(v) => {
                        if (v === "__create__") {
                          quickClientForm.reset({ name: "", city: "", ice: "" });
                          setIsQuickAddClientOpen(true);
                          return;
                        }
                        field.onChange(v === "none" ? null : parseInt(v));
                        clearAutoFill("clientId");
                      }}
                      value={field.value ? field.value.toString() : "none"}
                    >
                      <SelectTrigger
                        data-testid="select-cabinet"
                        className={afClass("clientId")}
                      >
                        <SelectValue placeholder="Choisir dans la liste des cabinets" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Aucun</SelectItem>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
                        <SelectItem value="__create__" className="text-primary font-medium border-t mt-1 pt-1">
                          <Plus className="h-3.5 w-3.5 mr-1 inline" />+ Nouveau cabinet
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div>
                <Label htmlFor="cabinet">Client (libre)</Label>
                <Input
                  id="cabinet"
                  {...form.register("cabinet", { onChange: () => clearAutoFill("cabinet") })}
                  className={afClass("cabinet")}
                  placeholder="Saisir le nom du client affiché sur la facture"
                  data-testid="input-client-libre"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="ville">Ville</Label>
              {villeIsCustom ? (
                <div className="flex gap-2">
                  <Input
                    id="ville"
                    {...form.register("ville")}
                    placeholder="Saisir la ville"
                    data-testid="input-ville"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setVilleIsCustom(false); form.setValue("ville", ""); }}
                    className="shrink-0 text-xs"
                  >
                    Liste
                  </Button>
                </div>
              ) : (
                <Controller
                  name="ville"
                  control={form.control}
                  render={({ field }) => (
                    <Select
                      onValueChange={(v) => {
                        if (v === "__autre__") {
                          setVilleIsCustom(true);
                          field.onChange("");
                        } else {
                          field.onChange(v === "__none__" ? "" : v);
                        }
                      }}
                      value={field.value && field.value !== "" ? field.value : "__none__"}
                    >
                      <SelectTrigger data-testid="select-ville">
                        <SelectValue placeholder="Sélectionner une ville" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        <SelectItem value="__none__">— Aucune —</SelectItem>
                        {MOROCCAN_CITIES.map((city) => (
                          <SelectItem key={city} value={city}>{city}</SelectItem>
                        ))}
                        <SelectItem value="__autre__">Autre...</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </div>

            {/* Prestation combobox */}
            <div>
              <Label>Prestation / Formation *</Label>
              <Controller
                name="prestation"
                control={form.control}
                render={({ field }) => (
                  <div className="space-y-1">
                    <Popover open={openPrestation} onOpenChange={setOpenPrestation}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          className={cn(
                            "w-full justify-between font-normal text-left h-auto min-h-9 py-1.5",
                            !field.value && "text-muted-foreground",
                            afClass("prestation")
                          )}
                          data-testid="btn-prestation-combobox"
                        >
                          <span className="line-clamp-1 text-sm">{field.value || "Choisir une formation (catalogue)…"}</span>
                          <ChevronsUpDown className="h-4 w-4 ml-2 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
                        <Command>
                          <CommandInput
                            placeholder="Rechercher une formation…"
                            onValueChange={(v) => {
                              // If they are typing in the search box, we could optionally fill it,
                              // but they should use the textarea for free-form multiple lines.
                            }}
                            data-testid="input-prestation-search"
                          />
                          <CommandList>
                            <CommandEmpty className="py-2 px-4 text-xs">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2 h-7 text-primary hover:text-primary hover:bg-primary/5"
                                onClick={() => {
                                  const term = (document.querySelector('[data-testid="input-prestation-search"]') as HTMLInputElement)?.value;
                                  if (term) {
                                    const current = field.value || "";
                                    const bulleted = term.startsWith("•") ? term : `• ${term}`;
                                    const newValue = current ? `${current}\n${bulleted}` : bulleted;
                                    field.onChange(newValue);
                                    clearAutoFill("prestation");
                                    setOpenPrestation(false);
                                  }
                                }}
                              >
                                <Plus className="h-3 w-3" />
                                <span>Ajouter comme nouvelle prestation</span>
                              </Button>
                            </CommandEmpty>

                            <CommandGroup heading="Formations (catalogue)">
                              {catalogs.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-slate-500">
                                  Aucune formation en base — ajoutez-les dans le menu Formations.
                                </div>
                              ) : (
                                catalogs.map((c) => (
                                  <CommandItem
                                    key={`cat-${c.id}`}
                                    value={c.name}
                                    onSelect={(v) => {
                                      const current = field.value || "";
                                      const bulleted = v.startsWith("•") ? v : `• ${v}`;
                                      const newValue = current ? `${current}\n${bulleted}` : bulleted;
                                      field.onChange(newValue);
                                      clearAutoFill("prestation");
                                      setOpenPrestation(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        field.value.includes(c.name) ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    {c.name}
                                  </CommandItem>
                                ))
                              )}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {/* Editable textarea for longer descriptions */}
                    <Textarea
                      value={field.value}
                      onChange={(e) => { field.onChange(e.target.value); clearAutoFill("prestation"); }}
                      placeholder="Ex: • Prestation A&#10;• Prestation B"
                      rows={4}
                      className={cn("text-sm font-mono leading-relaxed", afClass("prestation"))}
                      data-testid="input-prestation"
                    />
                  </div>
                )}
              />
              {form.formState.errors.prestation && (
                <p className="text-xs text-red-500 mt-1">{form.formState.errors.prestation.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="montantDh">Montant DH *</Label>
              <Input
                id="montantDh"
                type="number"
                step="0.01"
                {...form.register("montantDh", { onChange: () => clearAutoFill("montantDh") })}
                className={afClass("montantDh")}
                data-testid="input-montant"
              />
              {form.watch("montantDh") > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  Impôt 1%: {formatDHSmall(Number(form.watch("montantDh")) * IMPOTS_RATE)} &nbsp;·&nbsp; CNSS 3.1%: {formatDHSmall(Number(form.watch("montantDh")) * 0.031)}
                </p>
              )}
              {form.formState.errors.montantDh && (
                <p className="text-xs text-red-500 mt-1">{form.formState.errors.montantDh.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Mode de Paiement</Label>
                <Controller
                  name="modePaiement"
                  control={form.control}
                  render={({ field }) => (
                    <Select
                      onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                      value={field.value ?? "none"}
                    >
                      <SelectTrigger data-testid="select-mode-paiement">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">-</SelectItem>
                        <SelectItem value="virement">Virement</SelectItem>
                        <SelectItem value="cheque">Chèque</SelectItem>
                        <SelectItem value="espece">Espèce</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div>
                <Label htmlFor="numeroPaiement">N° Paiement / Référence</Label>
                <Input
                  id="numeroPaiement"
                  {...form.register("numeroPaiement", { onChange: () => clearAutoFill("numeroPaiement") })}
                  className={afClass("numeroPaiement")}
                  placeholder="Ex: OPER.CREDIT REF-VMB7774"
                  data-testid="input-numero-paiement"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="datePaiement">Date de paiement</Label>
                <div className="flex gap-2">
                  <Input
                    id="datePaiement"
                    {...form.register("datePaiement")}
                    placeholder="Ex: 28/02/2025"
                    data-testid="input-date-paiement"
                    className="flex-1"
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="icon" className="shrink-0 h-9 w-9">
                        <CalendarIcon className="h-4 w-4 text-slate-500" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <CalendarComponent
                        mode="single"
                        onSelect={(date) => {
                          if (date) form.setValue("datePaiement", format(date, "dd/MM/yyyy"));
                        }}
                        initialFocus
                        locale={fr}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div>
                <Label htmlFor="dateDeclaration">Date Déclaration</Label>
                <div className="flex gap-2">
                  <Input
                    id="dateDeclaration"
                    {...form.register("dateDeclaration")}
                    placeholder="Ex: 21/4/2025"
                    data-testid="input-date-declaration"
                    className="flex-1"
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="icon" className="shrink-0 h-9 w-9">
                        <CalendarIcon className="h-4 w-4 text-slate-500" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <CalendarComponent
                        mode="single"
                        onSelect={(date) => {
                          if (date) form.setValue("dateDeclaration", format(date, "dd/MM/yyyy"));
                        }}
                        initialFocus
                        locale={fr}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            {/* Hidden persistent storage for URLs */}
            <Controller
              name="invoiceDocxUrl"
              control={form.control}
              render={({ field }) => <input type="hidden" {...field} value={field.value || ""} />}
            />

            {/* Document Word */}
            <div className="space-y-4 border rounded-lg p-3 bg-slate-50/50">
              <div>
                <Label className="text-xs font-bold text-slate-500 uppercase">Document Word (.docx)</Label>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <input
                    ref={docxInputRef}
                    type="file"
                    accept=".docx"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) parseDocxAndFill(file);
                    }}
                  />
                  <Button
                    type="button"
                    variant={form.watch("invoiceDocxUrl") ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "transition-all",
                      form.watch("invoiceDocxUrl")
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                        : "border-blue-200 text-blue-700 hover:bg-blue-50"
                    )}
                    onClick={() => docxInputRef.current?.click()}
                    disabled={isParsing}
                  >
                    {isParsing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                    {form.watch("invoiceDocxUrl") ? "Word joint (Changer ?)" : "Joindre un Word"}
                  </Button>
                  {form.watch("invoiceDocxUrl") && (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-blue-700 border-blue-200"
                        disabled={isDownloadingFormDocx}
                        onClick={() => void handleDownloadFormDocx()}
                      >
                        {isDownloadingFormDocx ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        Télécharger
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={createInvoice.isPending || updateInvoice.isPending}
                data-testid="btn-submit-invoice"
              >
                {(createInvoice.isPending || updateInvoice.isPending) ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enregistrement...</>
                ) : (
                  editingInvoice ? "Mettre à jour" : "Créer"
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
            <AlertDialogTitle>Supprimer la facture ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. La facture sera définitivement supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDelete}
              data-testid="btn-confirm-delete"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Quick Add Cabinet Dialog */}
      <Dialog open={isQuickAddClientOpen} onOpenChange={setIsQuickAddClientOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nouveau cabinet</DialogTitle>
          </DialogHeader>
          <form onSubmit={quickClientForm.handleSubmit(onSubmitQuickClient)} className="space-y-4">
            <div>
              <Label htmlFor="qc-name">Nom / Raison sociale *</Label>
              <Input
                id="qc-name"
                {...quickClientForm.register("name")}
                placeholder="Ex: LMC Casablanca"
                data-testid="input-quick-client-name"
              />
              {quickClientForm.formState.errors.name && (
                <p className="text-xs text-red-500 mt-1">{quickClientForm.formState.errors.name.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="qc-city">Ville</Label>
              <Input
                id="qc-city"
                {...quickClientForm.register("city")}
                placeholder="Ex: Casablanca"
                data-testid="input-quick-client-city"
              />
            </div>
            <div>
              <Label htmlFor="qc-ice">ICE</Label>
              <Input
                id="qc-ice"
                {...quickClientForm.register("ice")}
                placeholder="Ex: 003503208000024"
                data-testid="input-quick-client-ice"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsQuickAddClientOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={createClient.isPending} data-testid="btn-submit-quick-client">
                {createClient.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Création...</>
                ) : "Ajouter"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

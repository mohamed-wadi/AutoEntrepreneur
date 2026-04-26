import { useRef, useState, useEffect, useCallback } from "react";
import { Redirect } from "wouter";
import {
  useListDeclarations,
  getListDeclarationsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { API_BASE } from "@/lib/api-base";
import { Layout } from "@/components/layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Landmark, Building2, FileCheck, Printer, Upload, Trash2, FileText, Image, Eye } from "lucide-react";
import { useReactToPrint } from "react-to-print";
import { useToast } from "@/hooks/use-toast";
import { fetchStorageBlobForPreview } from "@/lib/storage-url";
import { FilePreviewDialog, type FilePreviewPayload } from "@/components/file-preview-dialog";

type Trimestre = "T1" | "T2" | "T3" | "T4";

interface DeclarationDocument {
  id: number;
  trimestre: string;
  year: number;
  fileUrl: string;
  fileName: string;
  createdAt: string;
}

const TRIMESTRE_COLORS: Record<Trimestre, string> = {
  T1: "border-l-blue-400 bg-blue-50/50",
  T2: "border-l-emerald-400 bg-emerald-50/50",
  T3: "border-l-yellow-400 bg-yellow-50/50",
  T4: "border-l-purple-400 bg-purple-50/50",
};

const TRIMESTRE_DOT: Record<Trimestre, string> = {
  T1: "bg-blue-400",
  T2: "bg-emerald-400",
  T3: "bg-yellow-400",
  T4: "bg-purple-400",
};

const TRIMESTRE_LABEL: Record<Trimestre, string> = {
  T1: "Jan – Mar",
  T2: "Avr – Jun",
  T3: "Jul – Sep",
  T4: "Oct – Déc",
};

const TRIMESTRE_BADGE: Record<Trimestre, string> = {
  T1: "bg-blue-100 text-blue-800 border-blue-200",
  T2: "bg-emerald-100 text-emerald-800 border-emerald-200",
  T3: "bg-yellow-100 text-yellow-800 border-yellow-200",
  T4: "bg-purple-100 text-purple-800 border-purple-200",
};

const currentYear = new Date().getFullYear();
const BASE = API_BASE;

async function requestUploadUrl(file: File): Promise<{ uploadURL: string; objectPath: string }> {
  const res = await fetch(`${BASE}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/pdf" }),
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
  const absolute =
    uploadURL.startsWith("http://") || uploadURL.startsWith("https://")
      ? uploadURL
      : new URL(uploadURL, window.location.origin).href;
  const crossOrigin =
    absolute.startsWith("http") && new URL(absolute).origin !== window.location.origin;
  const res = await fetch(absolute, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/pdf" },
    credentials: crossOrigin ? "omit" : "include",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || "Échec du téléchargement");
  }
}

function isImageFile(fileName: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName);
}

export function Declarations() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const printRef = useRef<HTMLDivElement>(null);
  const isAdmin = user?.role === "admin";

  const [documents, setDocuments] = useState<DeclarationDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploadingTrimestre, setUploadingTrimestre] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const closePreview = () => {
    if (preview?.blobUrl) URL.revokeObjectURL(preview.blobUrl);
    setPreview(null);
  };

  const runPreview = async (url: string, fileName: string, docId: number) => {
    setPreviewLoadingId(docId);
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

  const { data: declarations = [], isLoading } = useListDeclarations(
    { year: selectedYear },
    {
      query: {
        queryKey: getListDeclarationsQueryKey({ year: selectedYear }),
        enabled: !!user,
      },
    }
  );

  const fetchDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/declaration-documents?year=${selectedYear}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json() as DeclarationDocument[];
        setDocuments(data);
      }
    } finally {
      setDocsLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    if (user) fetchDocuments();
  }, [user, fetchDocuments]);

  const handleUpload = async (trimestre: string, file: File) => {
    setUploadingTrimestre(trimestre);
    try {
      const { uploadURL, objectPath } = await requestUploadUrl(file);
      await uploadToGcs(file, uploadURL);
      const fileUrl = `${BASE}/api/storage${objectPath}?filename=${encodeURIComponent(file.name)}`;

      const res = await fetch(`${BASE}/api/declaration-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ trimestre, year: selectedYear, fileUrl, fileName: file.name }),
      });
      if (!res.ok) throw new Error("Erreur lors de l'enregistrement");

      await fetchDocuments();
      toast({ title: "Document ajouté", description: file.name });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur d'upload",
        description: err instanceof Error ? err.message : "Échec",
      });
    } finally {
      setUploadingTrimestre(null);
      const ref = fileRefs.current[trimestre];
      if (ref) ref.value = "";
    }
  };

  const handleDelete = async (docId: number) => {
    try {
      const res = await fetch(`${BASE}/api/declaration-documents/${docId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erreur lors de la suppression");
      await fetchDocuments();
      toast({ title: "Document supprimé" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: err instanceof Error ? err.message : "Échec",
      });
    }
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Déclarations-${selectedYear}`,
    pageStyle: `
      @page {
        size: A4 landscape;
        margin: 15mm 12mm;
      }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `,
  });

  if (isAuthLoading) return null;
  if (!user) return <Redirect to="/" />;

  const formatDH = (amount: number) =>
    new Intl.NumberFormat("fr-MA", {
      style: "currency",
      currency: "MAD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);

  const totalMontant = declarations.reduce((s, d) => s + Number(d.totalMontant), 0);
  const totalImpo = declarations.reduce((s, d) => s + Number(d.impotsAPayer), 0);
  const totalCnss = declarations.reduce((s, d) => s + Number(d.cnssAPayer), 0);

  const docsByTrimestre = (t: string) => documents.filter((d) => d.trimestre === t);

  const ALL_TRIMESTRES: Trimestre[] = ["T1", "T2", "T3", "T4"];

  return (
    <Layout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Déclarations Trimestrielles</h1>
          <p className="text-slate-500 mt-1">Calcul automatique Impôts (1%) et CNSS selon les montants des factures</p>
        </div>
        <div className="flex items-center gap-3">
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
          <button
            onClick={() => handlePrint()}
            data-testid="btn-print"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
            disabled={isLoading || declarations.length === 0}
          >
            <Printer className="h-4 w-4" />
            Télécharger / Imprimer
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <div className="bg-white rounded-lg border p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <FileCheck className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium text-slate-600">Chiffre d'affaires annuel</span>
              </div>
              <div className="text-2xl font-bold" data-testid="total-montant">{formatDH(totalMontant)}</div>
            </div>
            <div className="bg-white rounded-lg border p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <Landmark className="h-5 w-5 text-indigo-500" />
                <span className="text-sm font-medium text-slate-600">Impôts totaux (1%)</span>
              </div>
              <div className="text-2xl font-bold text-indigo-600" data-testid="total-impots">{formatDH(totalImpo)}</div>
            </div>
            <div className="bg-white rounded-lg border p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <Building2 className="h-5 w-5 text-emerald-500" />
                <span className="text-sm font-medium text-slate-600">CNSS totaux (somme des montants CNSS)</span>
              </div>
              <div className="text-2xl font-bold text-emerald-600" data-testid="total-cnss">{formatDH(totalCnss)}</div>
            </div>
          </div>

          {/* Declaration Table (screen + print) */}
          <div ref={printRef}>
            {/* Print-only header */}
            <div className="hidden print:block mb-6">
              <h1 className="text-2xl font-bold">Déclarations Trimestrielles — {selectedYear}</h1>
              <p className="text-sm text-gray-500 mt-1">
                Calcul automatique Impôts (1%) et CNSS • Généré le{" "}
                {new Date().toLocaleDateString("fr-MA", { day: "2-digit", month: "long", year: "numeric" })}
              </p>

              {/* Print summary row */}
              <div className="flex gap-8 mt-4 mb-4 text-sm">
                <div>
                  <span className="font-medium text-gray-600">CA annuel : </span>
                  <span className="font-bold">{formatDH(totalMontant)}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-600">Impôts totaux : </span>
                  <span className="font-bold text-indigo-700">{formatDH(totalImpo)}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-600">CNSS totaux : </span>
                  <span className="font-bold text-emerald-700">{formatDH(totalCnss)}</span>
                </div>
              </div>
              <hr className="border-gray-300" />
            </div>

            <div className="bg-white rounded-lg border shadow-sm overflow-hidden" data-testid="declarations-table">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Trimestre</th>
                    <th className="px-4 py-3 text-right">CA Total (DH)</th>
                    <th className="px-4 py-3 text-center">Factures</th>
                    <th className="px-4 py-3 text-center">Réglées</th>
                    <th className="px-4 py-3 text-center">En attente</th>
                    <th className="px-4 py-3 text-right">Impôts à payer (1%)</th>
                    <th className="px-4 py-3 text-right">CNSS à payer</th>
                    <th className="px-4 py-3 text-left">Date Déclaration</th>
                  </tr>
                </thead>
                <tbody>
                  {declarations.map((decl) => (
                    <tr
                      key={decl.trimestre}
                      className={`border-b border-l-4 last:border-b-0 ${TRIMESTRE_COLORS[decl.trimestre as Trimestre] ?? ""}`}
                      data-testid={`row-decl-${decl.trimestre}`}
                    >
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${TRIMESTRE_DOT[decl.trimestre as Trimestre]}`} />
                          <span className="font-bold text-base">{decl.trimestre}</span>
                          <span className="text-slate-400 text-xs">
                            ({TRIMESTRE_LABEL[decl.trimestre as Trimestre] ?? ""})
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right font-semibold" data-testid={`montant-${decl.trimestre}`}>
                        {formatDH(Number(decl.totalMontant))}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
                          {decl.totalInvoices}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                          {decl.paidInvoices}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                          {decl.pendingInvoices}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="font-semibold text-indigo-700" data-testid={`impots-${decl.trimestre}`}>
                          {formatDH(Number(decl.impotsAPayer))}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-semibold text-emerald-700" data-testid={`cnss-${decl.trimestre}`}>
                            {formatDH(Number(decl.cnssAPayer))}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-600 text-sm">
                        {decl.dateDeclaration ?? (
                          <span className="text-slate-300 italic">Non déclarée</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t font-bold">
                    <td className="px-4 py-3 text-slate-700">TOTAL {selectedYear}</td>
                    <td className="px-4 py-3 text-right">{formatDH(totalMontant)}</td>
                    <td className="px-4 py-3 text-center">
                      {declarations.reduce((s, d) => s + Number(d.totalInvoices), 0)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {declarations.reduce((s, d) => s + Number(d.paidInvoices), 0)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {declarations.reduce((s, d) => s + Number(d.pendingInvoices), 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-indigo-700">{formatDH(totalImpo)}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{formatDH(totalCnss)}</td>
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Print-only footer */}
            <p className="mt-4 text-xs text-slate-400 print:text-gray-400">
              * Calcul basé sur le montant HT des factures enregistrées sur la plateforme.
            </p>
          </div>

          <div className="mt-4 mb-8 grid grid-cols-1 md:grid-cols-2 gap-4 print:hidden">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-emerald-800">Note sur la CNSS</p>
              <p className="text-xs text-emerald-700 mt-1">
                Le total CNSS correspond a la somme des montants CNSS des factures du/des trimestre(s) affiche(s).
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-800">👉 Tu déclares :</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs text-amber-700 font-medium">
                <span className="opacity-70">T1 (Jan, Fév, Mar)</span>
                <span>avant fin avril</span>
                <span className="opacity-70">T2 (Avr, Mai, Jui)</span>
                <span>avant fin juillet</span>
                <span className="opacity-70">T3 (Jui, Aoû, Sep)</span>
                <span>avant fin octobre</span>
                <span className="opacity-70">T4 (Oct, Nov, Déc)</span>
                <span>avant fin janvier</span>
              </div>
            </div>
          </div>

          {/* Declaration Documents Upload Section */}
          <div className="print:hidden">
            <h2 className="text-xl font-semibold tracking-tight mb-4">
              Documents de déclaration — {selectedYear}
            </h2>
            <p className="text-sm text-slate-500 mb-5">
              Déposez ici vos captures d'écran ou PDF de l'avis de paiement (impôt + CNSS) du portail auto-entrepreneur.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {ALL_TRIMESTRES.map((t) => {
                const docs = docsByTrimestre(t);
                const isUploading = uploadingTrimestre === t;
                return (
                  <div
                    key={t}
                    className={`bg-white rounded-lg border-l-4 border shadow-sm ${TRIMESTRE_COLORS[t]}`}
                  >
                    <div className="px-4 pt-4 pb-3 border-b">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${TRIMESTRE_DOT[t]}`} />
                          <span className="font-bold">{t}</span>
                          <span className="text-xs text-slate-400">{TRIMESTRE_LABEL[t]}</span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TRIMESTRE_BADGE[t]}`}>
                          {docs.length} doc{docs.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>

                    <div className="px-4 py-3 space-y-2">
                      {docsLoading ? (
                        <div className="flex justify-center py-2">
                          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        </div>
                      ) : docs.length === 0 ? (
                        <p className="text-xs text-slate-400 italic text-center py-2">Aucun document</p>
                      ) : (
                        docs.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center gap-2 bg-white/80 border rounded-md px-2 py-1.5 group"
                          >
                            {isImageFile(doc.fileName) ? (
                              <Image className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            ) : (
                              <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            )}
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline truncate flex-1 min-w-0 text-left disabled:opacity-50"
                              title={`Aperçu : ${doc.fileName}`}
                              disabled={previewLoadingId === doc.id}
                              onClick={() => void runPreview(doc.fileUrl, doc.fileName, doc.id)}
                            >
                              {doc.fileName}
                            </button>
                            <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                className="text-blue-500 hover:text-blue-700 p-0.5 rounded disabled:opacity-50"
                                title="Aperçu"
                                disabled={previewLoadingId === doc.id}
                                onClick={() => void runPreview(doc.fileUrl, doc.fileName, doc.id)}
                              >
                                {previewLoadingId === doc.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                              {isAdmin && (
                                <button
                                  onClick={() => handleDelete(doc.id)}
                                  className="text-red-400 hover:text-red-600"
                                  title="Supprimer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {isAdmin && (
                      <div className="px-4 pb-4">
                        <input
                          ref={(el) => { fileRefs.current[t] = el; }}
                          type="file"
                          accept=".pdf,application/pdf,image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUpload(t, file);
                          }}
                        />
                        <button
                          onClick={() => fileRefs.current[t]?.click()}
                          disabled={isUploading}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white/60 px-3 py-2 text-xs font-medium text-slate-600 hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                        >
                          {isUploading ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Upload en cours…</>
                          ) : (
                            <><Upload className="h-3.5 w-3.5" />Ajouter un document</>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <p className="mt-6 text-xs text-slate-400 text-right print:hidden">
            * Calcul basé sur le montant HT des factures enregistrées sur la plateforme.
          </p>
        </>
      )}

      {preview ? (
        <FilePreviewDialog
          payload={preview}
          onOpenChange={(open) => {
            if (!open) closePreview();
          }}
        />
      ) : null}
    </Layout>
  );
}

// Helper to display the bracket max label next to the CNSS amount
function getCnssMaxLabel(ca: number): string {
  if (ca <= 500) return "500";
  if (ca <= 1000) return "1 000";
  if (ca <= 2500) return "2 500";
  if (ca <= 5000) return "5 000";
  if (ca <= 10000) return "10 000";
  if (ca <= 25000) return "25 000";
  if (ca <= 50000) return "50 000";
  return "∞";
}

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { invoicesTable, clientsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import multer from "multer";
import mammoth from "mammoth";
import {
  CreateInvoiceBody,
  UpdateInvoiceBody,
  GetInvoiceParams,
  UpdateInvoiceParams,
  DeleteInvoiceParams,
  ListInvoicesQueryParams,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

const IMPOTS_RATE = 0.01;
const CNSS_RATE = 0.0226;

function computeTax(montantDh: number) {
  return {
    impotAPayer: Math.round(montantDh * IMPOTS_RATE * 100) / 100,
    cnss: Math.round(montantDh * CNSS_RATE * 100) / 100,
  };
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.originalname.toLowerCase().endsWith(".docx")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Seuls les fichiers .docx sont acceptés"));
    }
  },
});

const MONTH_NUM: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

function normalizeMonthName(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const MONTH_PATTERN = "janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre";
// Matches "Le/Les 14, 15 et 16 Avril 2026" — separators between days: comma, space, "et", "&"
const DATE_IN_LINE_RE = new RegExp(
  `les?\\s+(\\d{1,2}(?:[\\s,]+(?:et\\s+)?\\d{1,2})*)\\s+(${MONTH_PATTERN})\\s+(\\d{4})`,
  "i"
);

function extractInvoiceFields(text: string): {
  numeroFacture: string | null;
  dateFacture: string | null;
  cabinet: string | null;
  ice: string | null;
  prestation: string | null;
  prestations: string[];
  dateFormation: string | null;
  montantDh: number | null;
  numeroPaiement: null;
  confidence: Record<string, number>;
} {
  const confidence: Record<string, number> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let numeroFacture: string | null = null;
  let dateFacture: string | null = null;
  let cabinet: string | null = null;
  let ice: string | null = null;
  let montantDh: number | null = null;
  let totalNetPayerSeen = false;

  for (const line of lines) {
    if (!numeroFacture) {
      const m = line.match(/facture\s+(?:num[eé]ro|n[o°])\s*[:=]?\s*(\d{1,3}\/\d{4})/i);
      if (m) { numeroFacture = m[1]; confidence["numeroFacture"] = 1.0; }
    }

    if (!dateFacture) {
      const m = line.match(/^date\s*[:=]\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
      if (m) { dateFacture = m[1]; confidence["dateFacture"] = 1.0; }
    }

    if (!ice) {
      const m = line.match(/ICE\s*[:=]\s*(\d{6,20})/i);
      if (m) { ice = m[1].replace(/\s+/g, ""); confidence["ice"] = 1.0; }
    }

    // Montant: "Total Net à payer" may have amount on same line OR the next non-empty line
    if (montantDh === null) {
      if (/total\s+net\s+[àa]\s+payer/i.test(line)) {
        const m = line.match(/total\s+net\s+[àa]\s+payer\s*[:=]?\s*([\d\s]+(?:[.,]\d{1,2})?)/i);
        if (m) {
          const raw = m[1].replace(/\s+/g, "").replace(",", ".");
          const parsed = parseFloat(raw);
          if (!isNaN(parsed) && parsed > 100) {
            montantDh = parsed;
            confidence["montantDh"] = 1.0;
          }
        }
        if (montantDh === null) totalNetPayerSeen = true;
      } else if (totalNetPayerSeen) {
        const raw = line.replace(/\s+/g, "").replace(",", ".");
        const parsed = parseFloat(raw);
        if (!isNaN(parsed) && parsed > 100) {
          montantDh = parsed;
          confidence["montantDh"] = 1.0;
        }
        totalNetPayerSeen = false;
      }
    }
  }

  // Extract cabinet: first meaningful line after "Date : ..."
  if (!cabinet) {
    let afterDate = false;
    for (const line of lines) {
      if (/^date\s*[:=]/i.test(line)) { afterDate = true; continue; }
      if (afterDate && line.length > 2 && !/^(adresse|ICE|tél|email|fax|RC|TP|IF|CNSS)/i.test(line)) {
        cabinet = line;
        confidence["cabinet"] = 0.8;
        break;
      }
    }
  }

  // Extract individual prestations from the Désignation table
  const prestations: string[] = [];
  const allDays: number[] = [];
  let sharedMonth: number | null = null;
  let sharedYear: number | null = null;
  let inDesignation = false;

  for (const line of lines) {
    if (/d[eé]signation/i.test(line) && /nbre|jour|prix|total/i.test(line)) {
      inDesignation = true;
      continue;
    }
    if (!inDesignation) continue;

    const cleaned = line.replace(/^[•·\-–—*]\s*/, "").trim();
    if (/^(montant|total\s+net|arret[eé]|attijar|bmce|cih|crm|banque|rib|signature)/i.test(cleaned)) break;
    if (/^\d[\d\s,]*$/.test(cleaned) || cleaned.length < 4) continue;

    const dateMatch = cleaned.match(DATE_IN_LINE_RE);
    let prestationName = cleaned;

    if (dateMatch) {
      // Collect all day numbers from this line's date
      const daysStr = dateMatch[1];
      const dayNums = daysStr.split(/[\s,]+/).map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d >= 1 && d <= 31);
      allDays.push(...dayNums);

      // Capture month/year (assume same for all prestations in the invoice)
      if (sharedMonth === null) sharedMonth = MONTH_NUM[normalizeMonthName(dateMatch[2])] ?? null;
      if (sharedYear === null) sharedYear = parseInt(dateMatch[3], 10);

      // Remove date portion from the prestation name
      const dateIdx = cleaned.search(/\bles?\s+\d/i);
      if (dateIdx > 0) prestationName = cleaned.substring(0, dateIdx).trim();
    }

    // Strip trailing table-column numbers (Nbre jours / Prix / Total)
    prestationName = prestationName.replace(/\s+\d[\d\s]*$/, "").trim();
    if (prestationName.length > 3) prestations.push(prestationName);
  }

  // Build compact dateFormation: "14&15/16/17/18/04/2026"
  // First two days are joined with "&"; all subsequent days are separated with "/"
  let dateFormation: string | null = null;
  if (allDays.length > 0 && sharedMonth !== null && sharedYear !== null) {
    const uniqueSortedDays = [...new Set(allDays)].sort((a, b) => a - b);
    const mm = String(sharedMonth).padStart(2, "0");
    const dayParts: string[] = [];
    for (let i = 0; i < uniqueSortedDays.length; i++) {
      if (i === 0) dayParts.push(String(uniqueSortedDays[i]));
      else if (i === 1) dayParts[0] = dayParts[0] + "&" + uniqueSortedDays[i];
      else dayParts.push(String(uniqueSortedDays[i]));
    }
    dateFormation = dayParts.join("/") + "/" + mm + "/" + String(sharedYear);
    confidence["dateFormation"] = 0.95;
  }

  // Fallback montant: pick the largest number, excluding 4-digit year values
  if (montantDh === null) {
    const candidates: number[] = [];
    for (const line of lines) {
      const ms = line.match(/\b(\d{3,8})\b/g);
      if (ms) {
        for (const n of ms) {
          const v = parseInt(n, 10);
          if (v >= 2000 && v <= 2099) continue; // skip year numbers
          if (v >= 100) candidates.push(v);
        }
      }
    }
    if (candidates.length > 0) {
      montantDh = Math.max(...candidates);
      confidence["montantDh"] = 0.4;
    }
  }

  const prestation = prestations.length > 0 ? prestations.join("\n") : null;
  if (prestation) confidence["prestation"] = 0.85;

  return {
    numeroFacture, dateFacture, cabinet, ice,
    prestation, prestations, dateFormation, montantDh,
    numeroPaiement: null, confidence,
  };
}

router.get("/invoices/next-numero", requireAuth, async (req, res): Promise<void> => {
  const year = new Date().getFullYear();
  const yearSuffix = String(year);

  const rows = await db.select({ numeroFacture: invoicesTable.numeroFacture })
    .from(invoicesTable)
    .where(sql`${invoicesTable.numeroFacture} LIKE ${"%" + yearSuffix}`)
    .orderBy(desc(invoicesTable.id));

  let maxSeq = 0;
  for (const row of rows) {
    const parts = row.numeroFacture.split("/");
    const seq = parseInt(parts[0], 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  const nextSeq = maxSeq + 1;
  const numeroFacture = `${String(nextSeq).padStart(2, "0")}/${year}`;

  res.json({ numeroFacture, sequence: nextSeq });
});

router.get("/invoices/prestations", requireAuth, async (req, res): Promise<void> => {
  const rows = await db
    .select({
      prestation: invoicesTable.prestation,
    })
    .from(invoicesTable);

  const allPrestations = new Set<string>();
  rows.forEach(row => {
    if (row.prestation) {
      // Split by newline and clean up bullets
      row.prestation.split(/\r?\n/).forEach(p => {
        const cleaned = p.replace(/^[•·\-–—*]\s*/, "").trim();
        if (cleaned.length > 2) {
          allPrestations.add(cleaned);
        }
      });
    }
  });

  res.json(Array.from(allPrestations).sort());
});

router.post("/invoices/parse-docx", requireAdmin, upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "Aucun fichier reçu" });
    return;
  }

  try {
    const result = await mammoth.extractRawText({ buffer: req.file.buffer });
    const text = result.value;

    const extracted = extractInvoiceFields(text);

    let clientId: number | null = null;
    let clientName: string | null = null;

    if (extracted.ice) {
      const [client] = await db
        .select()
        .from(clientsTable)
        .where(eq(clientsTable.ice, extracted.ice));
      if (client) {
        clientId = client.id;
        clientName = client.name;
        extracted.confidence["clientId"] = 1.0;
        extracted.confidence["clientName"] = 1.0;
      }
    }

    res.json({
      ...extracted,
      clientId,
      clientName,
    });
  } catch (err) {
    req.log.error({ err }, "Error parsing docx");
    const detail = err instanceof Error ? err.message : String(err);
    const fileSize = req.file?.buffer ? req.file.buffer.length : 0;
    res.status(500).json({
      error: `Impossible de lire le fichier Word (taille reçue: ${fileSize} octets). Détail technique: ${detail}`,
    });
  }
});

router.get("/invoices", requireAuth, async (req, res): Promise<void> => {
  const params = ListInvoicesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [];
  if (params.data.trimestre) conditions.push(eq(invoicesTable.trimestre, params.data.trimestre));
  if (params.data.year) conditions.push(eq(invoicesTable.year, params.data.year));
  if (params.data.statut) conditions.push(eq(invoicesTable.statut, params.data.statut));

  const invoices = await db
    .select({
      id: invoicesTable.id,
      numeroFacture: invoicesTable.numeroFacture,
      trimestre: invoicesTable.trimestre,
      year: invoicesTable.year,
      dateFormation: invoicesTable.dateFormation,
      dateFacture: invoicesTable.dateFacture,
      clientId: invoicesTable.clientId,
      clientName: clientsTable.name,
      clientIce: clientsTable.ice,
      cabinet: invoicesTable.cabinet,
      ville: invoicesTable.ville,
      prestation: invoicesTable.prestation,
      montantDh: invoicesTable.montantDh,
      modePaiement: invoicesTable.modePaiement,
      numeroPaiement: invoicesTable.numeroPaiement,
      datePaiement: invoicesTable.datePaiement,
      statut: invoicesTable.statut,
      dateDeclaration: invoicesTable.dateDeclaration,
      invoiceFileUrl: invoicesTable.invoiceFileUrl,
      invoiceDocxUrl: invoicesTable.invoiceDocxUrl,
      createdAt: invoicesTable.createdAt,
    })
    .from(invoicesTable)
    .leftJoin(clientsTable, eq(invoicesTable.clientId, clientsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(invoicesTable.year, invoicesTable.trimestre, invoicesTable.id);

  res.json(
    invoices.map((inv) => {
      const montant = toFiniteNumber(inv.montantDh, 0);
      return { ...inv, montantDh: montant, ...computeTax(montant) };
    }),
  );
});

router.post("/invoices", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [invoice] = await db.insert(invoicesTable).values({
    ...parsed.data,
    montantDh: String(toFiniteNumber(parsed.data.montantDh, 0)),
  }).returning();

  let clientName: string | null = null;
  let clientIce: string | null = null;
  if (invoice.clientId) {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, invoice.clientId));
    clientName = client?.name ?? null;
    clientIce = client?.ice ?? null;
  }

  const montant = toFiniteNumber(invoice.montantDh, 0);
  res.status(201).json({ ...invoice, montantDh: montant, ...computeTax(montant), clientName, clientIce });
});

router.get("/invoices/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [invoice] = await db
    .select({
      id: invoicesTable.id,
      numeroFacture: invoicesTable.numeroFacture,
      trimestre: invoicesTable.trimestre,
      year: invoicesTable.year,
      dateFormation: invoicesTable.dateFormation,
      dateFacture: invoicesTable.dateFacture,
      clientId: invoicesTable.clientId,
      clientName: clientsTable.name,
      clientIce: clientsTable.ice,
      cabinet: invoicesTable.cabinet,
      ville: invoicesTable.ville,
      prestation: invoicesTable.prestation,
      montantDh: invoicesTable.montantDh,
      modePaiement: invoicesTable.modePaiement,
      numeroPaiement: invoicesTable.numeroPaiement,
      datePaiement: invoicesTable.datePaiement,
      statut: invoicesTable.statut,
      dateDeclaration: invoicesTable.dateDeclaration,
      invoiceFileUrl: invoicesTable.invoiceFileUrl,
      invoiceDocxUrl: invoicesTable.invoiceDocxUrl,
      createdAt: invoicesTable.createdAt,
    })
    .from(invoicesTable)
    .leftJoin(clientsTable, eq(invoicesTable.clientId, clientsTable.id))
    .where(eq(invoicesTable.id, params.data.id));

  if (!invoice) {
    res.status(404).json({ error: "Facture introuvable" });
    return;
  }
  const montant = toFiniteNumber(invoice.montantDh, 0);
  res.json({ ...invoice, montantDh: montant, ...computeTax(montant) });
});

router.patch("/invoices/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { montantDh, ...rest } = parsed.data;
  const updateValues = montantDh !== undefined
    ? { ...rest, montantDh: String(toFiniteNumber(montantDh, 0)) }
    : rest;

  const [invoice] = await db.update(invoicesTable)
    .set(updateValues)
    .where(eq(invoicesTable.id, params.data.id))
    .returning();

  if (!invoice) {
    res.status(404).json({ error: "Facture introuvable" });
    return;
  }

  let clientName: string | null = null;
  let clientIce: string | null = null;
  if (invoice.clientId) {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, invoice.clientId));
    clientName = client?.name ?? null;
    clientIce = client?.ice ?? null;
  }

  const montant = toFiniteNumber(invoice.montantDh, 0);
  res.json({ ...invoice, montantDh: montant, ...computeTax(montant), clientName, clientIce });
});

router.delete("/invoices/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [invoice] = await db.delete(invoicesTable).where(eq(invoicesTable.id, params.data.id)).returning();
  if (!invoice) {
    res.status(404).json({ error: "Facture introuvable" });
    return;
  }
  res.sendStatus(204);
});

export default router;

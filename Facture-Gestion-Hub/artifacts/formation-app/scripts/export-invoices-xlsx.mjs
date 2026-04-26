import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import XLSX from "xlsx-js-style";

const OUTPUT_DIR = process.env.REGISTRES_OUTPUT_DIR ?? "backups/registres";
const STAMP = process.env.EXPORT_STAMP;
const DB_USER = process.env.POSTGRES_USER ?? "admin";
const DB_PASSWORD = process.env.POSTGRES_PASSWORD ?? "adminpassword";
const DB_NAME = process.env.POSTGRES_DB ?? "facture_db";
const CNSS_RATE = 0.0226;
const IGNORED_YEARS = new Set(
  (process.env.EXPORT_IGNORED_YEARS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v)),
);

if (!STAMP) {
  console.error("Missing EXPORT_STAMP");
  process.exit(1);
}

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

const statusLabel = {
  paye: "Payée",
  regle: "Payée",
  en_attente: "En attente",
};

function normalizeStatus(status) {
  return status === "paye" || status === "regle" ? "paye" : "en_attente";
}

function formatMoney(v) {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("fr-MA", {
    style: "currency",
    currency: "MAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function loadInvoicesFromDb() {
  const sql = `
SELECT COALESCE(json_agg(t), '[]'::json)
FROM (
  SELECT
    i.id,
    i.trimestre,
    i.year,
    i.date_formation AS "dateFormation",
    i.date_facture AS "dateFacture",
    i.numero_facture AS "numeroFacture",
    i.cabinet,
    COALESCE(c.name, '') AS "clientName",
    i.ville,
    i.prestation,
    i.montant_dh AS "montantDh",
    i.mode_paiement AS "modePaiement",
    i.numero_paiement AS "numeroPaiement",
    i.date_paiement AS "datePaiement",
    i.statut,
    i.date_declaration AS "dateDeclaration",
    ROUND(COALESCE(i.montant_dh, 0) * 0.01, 2) AS "impotAPayer",
    ROUND(COALESCE(i.montant_dh, 0) * ${CNSS_RATE}, 2) AS "cnss"
  FROM invoices i
  LEFT JOIN clients c ON c.id = i.client_id
  ORDER BY i.year, i.trimestre, i.numero_facture
) t;
  `.trim();

  const shellCmd = `PGPASSWORD='${DB_PASSWORD.replace(/'/g, "'\\''")}' psql -U ${DB_USER} -d ${DB_NAME} -t -A -c "${sql.replace(/"/g, '\\"')}"`;
  const raw = execFileSync(
    "docker",
    ["compose", "exec", "-T", "db", "sh", "-lc", shellCmd],
    { encoding: "utf8" },
  ).trim();

  if (!raw) return [];
  return JSON.parse(raw);
}

function buildWorkbook(rows, year, tri) {
  const applyRowBackground = (ws, rowIndex, colorHexNoHash) => {
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

  const totalMontant = rows.reduce((s, r) => s + Number(r.montantDh ?? 0), 0);
  const totalImpot = rows.reduce((s, r) => s + Number(r.impotAPayer ?? Number(r.montantDh) * 0.01), 0);
  const totalCnss = rows.reduce((s, r) => s + Number(r.cnss ?? Number(r.montantDh) * CNSS_RATE), 0);

  const body = rows.map((r) => {
    const montant = Number(r.montantDh ?? 0);
    const impot = Number(r.impotAPayer ?? montant * 0.01);
    const cnss = Number(r.cnss ?? montant * CNSS_RATE);
    return [
      r.trimestre ?? "",
      r.dateFormation ?? "",
      r.dateFacture ?? "",
      r.numeroFacture ?? "",
      r.cabinet ?? "",
      r.clientName ?? "",
      r.ville ?? "",
      r.prestation ?? "",
      formatMoney(montant),
      r.modePaiement ?? "",
      r.numeroPaiement ?? "",
      r.datePaiement ?? "",
      statusLabel[r.statut] ?? r.statut ?? "",
      r.dateDeclaration ?? "",
      formatMoney(impot),
      formatMoney(cnss),
    ];
  });

  const data = [
    [`Registre ${year} ${tri}`],
    [`${rows.length} facture(s)`],
    [],
    headers,
    ...body,
    ["", "", "", "", "", "", "", "TOTAL", formatMoney(totalMontant), "", "", "", "", "", formatMoney(totalImpot), formatMoney(totalCnss)],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 12 },
    { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 36 },
    { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 14 },
    { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
  ];

  // Header row color: #d0d0d0
  const headerRowIndex = 3;
  applyRowBackground(ws, headerRowIndex, "D0D0D0");

  // Data row colors:
  // - payé: #ffff00
  // - en attente: #f9e2d5
  const dataRowStartIndex = headerRowIndex + 1;
  rows.forEach((r, i) => {
    const normalized = normalizeStatus(r.statut);
    const color = normalized === "paye" ? "FFFF00" : "F9E2D5";
    applyRowBackground(ws, dataRowStartIndex + i, color);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Factures");
  return wb;
}

async function main() {
  const all = loadInvoicesFromDb();

  const byKey = new Map();
  for (const inv of all) {
    const y = Number(inv.year);
    const tri = String(inv.trimestre ?? "");
    if (!Number.isFinite(y) || !tri || IGNORED_YEARS.has(y)) continue;
    const key = `${y}-${tri}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(inv);
  }

  // Rebuild folder to avoid keeping old ignored years from previous runs.
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let count = 0;
  for (const [key, rows] of byKey.entries()) {
    const [year, tri] = key.split("-");
    const outDir = path.join(OUTPUT_DIR, year, tri);
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `registre_${year}_${tri}_${STAMP}.xlsx`);
    const wb = buildWorkbook(rows, year, tri);
    const arr = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
    fs.writeFileSync(file, Buffer.from(arr));
    count++;
  }

  console.log(`Exported ${count} registre xlsx file(s).`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

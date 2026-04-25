import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as XLSX from "xlsx";

const OUTPUT_DIR = process.env.REGISTRES_OUTPUT_DIR ?? "backups/registres";
const STAMP = process.env.EXPORT_STAMP;
const DB_USER = process.env.POSTGRES_USER ?? "admin";
const DB_PASSWORD = process.env.POSTGRES_PASSWORD ?? "adminpassword";
const DB_NAME = process.env.POSTGRES_DB ?? "facture_db";

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
  regle: "Réglée",
  en_attente: "En attente",
};

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
    ROUND(COALESCE(i.montant_dh, 0) * 0.031, 2) AS "cnss"
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
  const totalMontant = rows.reduce((s, r) => s + Number(r.montantDh ?? 0), 0);
  const totalImpot = rows.reduce((s, r) => s + Number(r.impotAPayer ?? Number(r.montantDh) * 0.01), 0);
  const totalCnss = rows.reduce((s, r) => s + Number(r.cnss ?? Number(r.montantDh) * 0.031), 0);

  const body = rows.map((r) => {
    const montant = Number(r.montantDh ?? 0);
    const impot = Number(r.impotAPayer ?? montant * 0.01);
    const cnss = Number(r.cnss ?? montant * 0.031);
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
    if (!Number.isFinite(y) || !tri) continue;
    const key = `${y}-${tri}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(inv);
  }

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

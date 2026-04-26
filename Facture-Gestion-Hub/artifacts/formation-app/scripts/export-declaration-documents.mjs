import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const OUTPUT_DIR = process.env.DECLARATIONS_OUTPUT_DIR ?? "backups/declarations";
const LOCAL_UPLOAD_ROOT = process.env.LOCAL_UPLOAD_ROOT ?? ".local-uploads";
const DB_USER = process.env.POSTGRES_USER ?? "admin";
const DB_PASSWORD = process.env.POSTGRES_PASSWORD ?? "adminpassword";
const DB_NAME = process.env.POSTGRES_DB ?? "facture_db";
const IGNORED_YEARS = new Set(
  (process.env.EXPORT_IGNORED_YEARS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v)),
);

function sanitizeFileName(name) {
  return String(name ?? "document")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let i = 2;
  while (true) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    i += 1;
  }
}

function extractObjectRelativePath(fileUrl) {
  const match = String(fileUrl ?? "").match(/\/objects\/([^?]+)/i);
  if (!match?.[1]) return null;
  return match[1];
}

function loadDeclarationDocs() {
  const sql = `
SELECT COALESCE(json_agg(t), '[]'::json)
FROM (
  SELECT
    id,
    trimestre,
    year,
    file_url AS "fileUrl",
    file_name AS "fileName",
    created_at AS "createdAt"
  FROM declaration_documents
  ORDER BY year, trimestre, created_at, id
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

function main() {
  const docs = loadDeclarationDocs();
  // Rebuild folder from scratch to avoid duplicate files like "(2)", "(3)" across runs.
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let copied = 0;
  let missing = 0;

  for (const doc of docs) {
    const year = Number(doc.year);
    const trimestre = String(doc.trimestre ?? "").toUpperCase();
    if (!Number.isFinite(year) || IGNORED_YEARS.has(year) || !["T1", "T2", "T3", "T4"].includes(trimestre)) continue;

    const relObjectPath = extractObjectRelativePath(doc.fileUrl);
    if (!relObjectPath) continue;

    const sourcePath = path.join(LOCAL_UPLOAD_ROOT, relObjectPath.replace(/\//g, path.sep));
    if (!fs.existsSync(sourcePath)) {
      missing += 1;
      continue;
    }

    const outDir = path.join(OUTPUT_DIR, String(year), trimestre);
    fs.mkdirSync(outDir, { recursive: true });

    const originalName = sanitizeFileName(doc.fileName) || `document_${doc.id}`;
    const targetPath = uniquePath(path.join(outDir, originalName));
    fs.copyFileSync(sourcePath, targetPath);
    copied += 1;
  }

  console.log(`Exported declaration documents: copied=${copied}, missing=${missing}`);
}

main();

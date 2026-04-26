import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, clientsTable, invoicesTable, catalogsTable } from "@workspace/db";
import { DEFAULT_FORMATION_NAMES } from "@workspace/formations";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

function catalogKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ajoute toute formation officielle absente du catalogue (idempotent). */
async function ensureDefaultCatalogEntries(): Promise<void> {
  const rows = await db.select({ name: catalogsTable.name }).from(catalogsTable);
  const have = new Set(rows.map((r) => catalogKey(r.name)));
  for (const name of DEFAULT_FORMATION_NAMES) {
    const k = catalogKey(name);
    if (have.has(k)) continue;
    await db.insert(catalogsTable).values({ name });
    have.add(k);
    logger.info({ name }, "Catalog: formation par défaut ajoutée");
  }
}

/** Supprime les formations hors-liste officielle (idempotent). */
async function pruneNonDefaultCatalogEntries(): Promise<void> {
  const allowed = new Set(DEFAULT_FORMATION_NAMES.map((n) => catalogKey(n)));
  const rows = await db.select({ id: catalogsTable.id, name: catalogsTable.name }).from(catalogsTable);
  for (const r of rows) {
    if (allowed.has(catalogKey(r.name))) continue;
    await db.delete(catalogsTable).where(eq(catalogsTable.id, r.id));
    logger.info({ id: r.id, name: r.name }, "Catalog: formation supprimée (hors liste officielle)");
  }
}

function cabinetKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "");
}

const DEFAULT_CABINET_NAMES: readonly string[] = [
  "TCERT MOROCCO TUV Nord",
  "EVIX MANAGEMENT (TUV Nord)",
  "EVIX MANAGEMENT",
  "LMC",
  "ESAQ",
  "ESAQ CONSEIL",
  "LICORNE Group",
  "TUV NORD",
  "TMC (Tagmat Management Consulting)",
  "TRITECH Frère de Arach",
  "TRAME GALAXY",
  "CAT Engineering",
  "SP Solution",
  "Cabinet hassan de la part de Mme Khawla LMC",
  "Cabinet CAT engineering",
] as const;

/** Ajoute les cabinets manquants (idempotent) */
async function ensureDefaultCabinets(): Promise<void> {
  const rows = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable);
  const have = new Set(rows.map((r) => cabinetKey(r.name)));
  for (const name of DEFAULT_CABINET_NAMES) {
    const k = cabinetKey(name);
    if (have.has(k)) continue;
    await db.insert(clientsTable).values({ name, city: null, contact: null, phone: null, ice: null });
    have.add(k);
    logger.info({ name }, "Clients: cabinet ajouté (liste par défaut)");
  }
}

/** Dédoublonne les cabinets par nom (insensible casse/accents/espaces). */
async function dedupeCabinetsByName(): Promise<void> {
  const rows = await db
    .select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .orderBy(clientsTable.createdAt);

  const keepByKey = new Map<string, { id: number; name: string }>();
  for (const r of rows) {
    const k = cabinetKey(r.name);
    if (!k) continue;
    if (!keepByKey.has(k)) keepByKey.set(k, r);
  }

  for (const r of rows) {
    const k = cabinetKey(r.name);
    const keep = keepByKey.get(k);
    if (!keep) continue;
    if (keep.id === r.id) continue;

    // Re-point invoices.clientId vers le cabinet conservé, puis supprime le doublon.
    await db.execute(sql`UPDATE invoices SET client_id = ${keep.id} WHERE client_id = ${r.id}`);
    await db.delete(clientsTable).where(eq(clientsTable.id, r.id));
    logger.info({ removedId: r.id, keptId: keep.id, name: r.name }, "Clients: doublon supprimé");
  }
}

export async function seedDatabase(): Promise<void> {
  // Idempotent schema migrations for columns added after initial deploy
  await db.execute(sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS ice TEXT`);
  await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_docx_url TEXT`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret_enc TEXT`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_temp_secret_enc TEXT`);
  // Normalize invalid numeric values that break aggregates and UI (Postgres numeric supports NaN)
  await db.execute(sql`UPDATE invoices SET montant_dh = 0 WHERE montant_dh = 'NaN'::numeric`);

  const existingAdmin = await db.select().from(usersTable).where(eq(usersTable.username, "admin"));

  if (existingAdmin.length === 0) {
    logger.info("Seeding default users...");
    const adminHash = await bcrypt.hash("admin2026", 10);
    const viewerHash = await bcrypt.hash("viewer2026", 10);

    await db.insert(usersTable).values([
      { username: "admin", passwordHash: adminHash, role: "admin" },
      { username: "viewer", passwordHash: viewerHash, role: "viewer" },
    ]);
    logger.info("Default users seeded: admin/admin2026 and viewer/viewer2026");
  }

  if (process.env.SYNC_BUILTIN_USER_PASSWORDS?.trim() === "true") {
    logger.warn(
      "SYNC_BUILTIN_USER_PASSWORDS is enabled: resetting admin/viewer password hashes and 2FA fields",
    );
    const adminHash = await bcrypt.hash("admin2026", 10);
    const viewerHash = await bcrypt.hash("viewer2026", 10);
    await db
      .update(usersTable)
      .set({
        passwordHash: adminHash,
        twoFactorEnabled: false,
        twoFactorSecretEnc: null,
        twoFactorTempSecretEnc: null,
      })
      .where(eq(usersTable.username, "admin"));
    await db
      .update(usersTable)
      .set({
        passwordHash: viewerHash,
        twoFactorEnabled: false,
        twoFactorSecretEnc: null,
        twoFactorTempSecretEnc: null,
      })
      .where(eq(usersTable.username, "viewer"));
    logger.info(
      "Built-in users updated. Remove SYNC_BUILTIN_USER_PASSWORDS from env after you confirm login works.",
    );
  }


  const existingClients = await db.select().from(clientsTable);
  if (existingClients.length === 0) {
    logger.info("Seeding sample clients...");
    await db.insert(clientsTable).values([
      { name: "TCERT MOROCCO TUV Nord", city: "Casablanca", ice: "002345678000056" },
      { name: "EVIX MANAGEMENT", city: "Casablanca", ice: "001234567000089" },
      { name: "LMC", city: "Fes", ice: "004567890000012" },
      { name: "ESAQ", city: "Casablanca", ice: "003503208000024" },
      { name: "NGE", city: "Multiple", ice: "005678901000034" },
      { name: "FINATECH", city: "Casablanca", ice: "006789012000045" },
    ]);
    logger.info("Sample clients seeded");
  }

  const existingInvoices = await db.select().from(invoicesTable);
  if (existingInvoices.length === 0) {
    logger.info("Seeding sample invoices...");
    const clients = await db.select().from(clientsTable);
    const clientMap: Record<string, number> = {};
    for (const c of clients) clientMap[c.name] = c.id;

    await db.insert(invoicesTable).values([
      {
        numeroFacture: "01/2026",
        trimestre: "T1",
        year: 2026,
        dateFormation: "05/02/2026",
        dateFacture: "05/02/2026",
        clientId: clientMap["TCERT MOROCCO TUV Nord"] ?? null,
        cabinet: "TCERT MOROCCO TUV Nord",
        ville: "Casablanca",
        prestation: "Habilitation électrique",
        montantDh: "5300",
        modePaiement: "virement",
        numeroPaiement: "OPER.CREDIT REF-VMB7774",
        datePaiement: "28/2/2026",
        statut: "paye",
        dateDeclaration: "21/4/2026",
      },
      {
        numeroFacture: "03/2026",
        trimestre: "T1",
        year: 2026,
        dateFormation: "18/3/2026",
        dateFacture: "18/3/2026",
        clientId: clientMap["EVIX MANAGEMENT"] ?? null,
        cabinet: "EVIX MANAGEMENT",
        ville: "Casablanca",
        prestation: "Habilitation électrique",
        montantDh: "7500",
        modePaiement: "virement",
        numeroPaiement: "STE EVIX MANAGEMENT",
        datePaiement: "25/3/2026",
        statut: "paye",
        dateDeclaration: "21/4/2026",
      },
      {
        numeroFacture: "02/2026",
        trimestre: "T2",
        year: 2026,
        dateFormation: "27&28/02/2026",
        dateFacture: "08/03/2026",
        clientId: clientMap["LMC"] ?? null,
        cabinet: "LMC",
        ville: "Fes",
        prestation: "Sauveteurs Secouristes du Travail",
        montantDh: "6000",
        modePaiement: "virement",
        datePaiement: "03/6/2026",
        statut: "paye",
        dateDeclaration: null,
      },
      {
        numeroFacture: "04/2026",
        trimestre: "T2",
        year: 2026,
        dateFormation: "07&08/04/2026",
        dateFacture: "08/04/2026",
        clientId: clientMap["LMC"] ?? null,
        cabinet: "LMC",
        ville: "Ain Harrouda",
        prestation: "Sauveteurs Secouristes du Travail",
        montantDh: "5000",
        modePaiement: "virement",
        datePaiement: "03/6/2026",
        statut: "paye",
        dateDeclaration: null,
      },
      {
        numeroFacture: "05/2026",
        trimestre: "T2",
        year: 2026,
        dateFormation: "17et19/04/2026",
        dateFacture: "20/04/2026",
        clientId: clientMap["LMC"] ?? null,
        cabinet: "LMC",
        ville: "Tanger",
        prestation: "SST & incendie",
        montantDh: "6500",
        modePaiement: "virement",
        datePaiement: "03/6/2026",
        statut: "paye",
        dateDeclaration: null,
      },
      {
        numeroFacture: "06/2026",
        trimestre: "T2",
        year: 2026,
        dateFormation: "14/5/2026",
        dateFacture: "20/5/2026",
        clientId: clientMap["ESAQ"] ?? null,
        cabinet: "ESAQ",
        ville: "Casablanca",
        prestation: "Espaces confinés",
        montantDh: "3750",
        modePaiement: "virement",
        datePaiement: "04/6/2026",
        statut: "paye",
        dateDeclaration: null,
      },
      {
        numeroFacture: "07/2026",
        trimestre: "T2",
        year: 2026,
        dateFormation: "28&29/05/2026",
        dateFacture: "29/5/2026",
        clientId: clientMap["LMC"] ?? null,
        cabinet: "LMC",
        ville: "Safi",
        prestation: "Montage et démontage échafaudage\nInspection échafaudage",
        montantDh: "6000",
        modePaiement: null,
        statut: "en_attente",
        dateDeclaration: null,
      },
    ]);
    logger.info("Sample invoices seeded");
  }

  // IMPORTANT:
  // Keep user changes in Formations by default.
  // If you explicitly want to enforce the official list on each startup,
  // set SYNC_DEFAULT_CATALOGS=true.
  if (process.env.SYNC_DEFAULT_CATALOGS?.trim() === "true") {
    await ensureDefaultCatalogEntries();
    await pruneNonDefaultCatalogEntries();
  }

  // Cabinets (clients):
  // Keep user changes by default.
  // If you explicitly want to enforce the default cabinet list on startup,
  // set SYNC_DEFAULT_CABINETS=true.
  if (process.env.SYNC_DEFAULT_CABINETS?.trim() === "true") {
    await ensureDefaultCabinets();
    await dedupeCabinetsByName();
  }
}

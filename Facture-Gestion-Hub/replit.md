# Gestion Formations

A secure, hosted web platform for a Moroccan auto-entrepreneur managing training courses. Replaces an Excel-based workflow. All UI is in French.

## Architecture

**Monorepo (pnpm workspaces):**
- `artifacts/formation-app` — React + Vite frontend (SPA)
- `artifacts/api-server` — Express.js REST API backend
- `lib/db` — Drizzle ORM schema + PostgreSQL migrations
- `lib/api-spec` — OpenAPI 3.0 specification
- `lib/api-client-react` — Generated React Query hooks (Orval)
- `lib/api-zod` — Generated Zod validators (Orval)

## Features

- **Two roles**: `admin` (full CRUD) and `viewer` (read-only, hidden Clients menu)
- **Session auth**: express-session + bcryptjs; credentials admin/admin2026 and viewer/viewer2026
- **Clients**: Card-based CRUD management (admin only), includes ICE field (Identifiant Commun de l'Entreprise)
- **Invoices**: Full table with trimestre color coding, status badges, admin CRUD; computed Impôt (1%) per invoice; prestation combobox with autocomplete from history; Word (.docx) import that auto-fills fields with amber highlight; original filename preserved on docx download via ?filename= query param
- **Declarations**: Auto-calculates Impôts (1%) and CNSS (tranche fixe) by quarter from invoice totals. CNSS uses 8-bracket table (0–500→300 DH, …, +50k→3600 DH). Each quarter has a document upload slot for official payment slips (PDF/image)
- **Declaration Documents**: DB table `declaration_documents` stores uploaded avis de paiement per quarter; API routes GET/POST/DELETE /api/declaration-documents
- **Dashboard**: KPI stats (CA, factures, impayés, impôts, CNSS tranche fixe) with trimestre breakdown
- **Seed data**: Server seeds default users and sample invoices on first startup
- **Word parsing**: POST /api/invoices/parse-docx (admin-only, multer + mammoth) extracts invoice fields from .docx; matches ICE to client

## Database Schema

PostgreSQL, managed via Drizzle ORM:
- `users` — id, username, passwordHash, role (admin|viewer)
- `clients` — id, name, city, contact, phone, ice
- `invoices` — id, numeroFacture, trimestre, year, dateFormation, dateFacture, clientId, cabinet, ville, prestation, montantDh, modePaiement, numeroPaiement, datePaiement, statut (paye|regle|en_attente), dateDeclaration, invoiceFileUrl, invoiceDocxUrl
- `declaration_documents` — id, trimestre, year, fileUrl, fileName, createdAt

## Key Files

- `artifacts/api-server/src/app.ts` — Express app setup with session middleware
- `artifacts/api-server/src/routes/` — auth, clients, invoices, declarations, stats
- `artifacts/api-server/src/lib/seed.ts` — Database seeding on startup
- `artifacts/formation-app/src/pages/` — login, dashboard, invoices, clients, declarations
- `artifacts/formation-app/src/lib/auth.tsx` — AuthContext provider
- `artifacts/formation-app/src/components/layout.tsx` — Sidebar with role-aware nav
- `lib/api-spec/openapi.yaml` — Single source of truth for API
- `lib/db/src/schema/` — Drizzle ORM schema definitions

## Running

- API server: port from $PORT env var (dev: 8080)
- Frontend: port from $PORT env var (dev: 19509)
- Both managed by Replit workflows

## Generating API Client

When changing the OpenAPI spec:
```bash
cd lib/api-spec && pnpm exec orval --config ./orval.config.ts
# Recreate lib/api-zod/src/generated/storage.ts (wiped by clean:true)
# Rebuild declarations for both packages:
pnpm exec tsc -p lib/api-client-react/tsconfig.json
pnpm exec tsc -p lib/api-zod/tsconfig.json
pnpm exec tsc -p lib/db/tsconfig.json
```
Note: api-zod/tsconfig.json has `lib: ["es2022", "dom"]` to support the `File` type in parse-docx Zod schema.

## Environment

- `DATABASE_URL` — PostgreSQL connection string (Replit managed)
- `SESSION_SECRET` — Express session secret (defaults to dev value if missing)

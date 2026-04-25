import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  numeroFacture: text("numero_facture").notNull().unique(),
  trimestre: text("trimestre").notNull(), // T1, T2, T3, T4
  year: integer("year").notNull(),
  dateFormation: text("date_formation"), // stored as text e.g. "27&28/02/2025"
  dateFacture: text("date_facture"), // stored as text e.g. "08/04/2025"
  clientId: integer("client_id"),
  cabinet: text("cabinet"),
  ville: text("ville"),
  prestation: text("prestation").notNull(),
  montantDh: numeric("montant_dh", { precision: 12, scale: 2 }).notNull(),
  modePaiement: text("mode_paiement"), // virement | cheque | espece
  numeroPaiement: text("numero_paiement"),
  datePaiement: text("date_paiement"), // stored as text
  statut: text("statut").notNull().default("en_attente"), // paye | regle | en_attente
  dateDeclaration: text("date_declaration"), // stored as text e.g. "21/4/2025"
  invoiceFileUrl: text("invoice_file_url"),
  invoiceDocxUrl: text("invoice_docx_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;

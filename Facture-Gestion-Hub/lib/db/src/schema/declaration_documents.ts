import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const declarationDocumentsTable = pgTable("declaration_documents", {
  id: serial("id").primaryKey(),
  trimestre: text("trimestre").notNull(), // T1, T2, T3, T4
  year: integer("year").notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDeclarationDocumentSchema = createInsertSchema(declarationDocumentsTable).omit({ id: true, createdAt: true });
export type InsertDeclarationDocument = z.infer<typeof insertDeclarationDocumentSchema>;
export type DeclarationDocument = typeof declarationDocumentsTable.$inferSelect;

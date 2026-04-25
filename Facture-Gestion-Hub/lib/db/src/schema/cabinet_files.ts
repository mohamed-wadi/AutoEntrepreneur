import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const cabinetFilesTable = pgTable("cabinet_files", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  contentType: text("content_type"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CabinetFile = typeof cabinetFilesTable.$inferSelect;

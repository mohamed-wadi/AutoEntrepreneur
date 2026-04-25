import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const catalogsTable = pgTable("catalogs", {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(), // Nom de la formation (Unique)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCatalogSchema = createInsertSchema(catalogsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCatalog = z.infer<typeof insertCatalogSchema>;
export type Catalog = typeof catalogsTable.$inferSelect;

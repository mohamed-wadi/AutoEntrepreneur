import { pgTable, serial, varchar, timestamp } from "drizzle-orm/pg-core";

export const globalFilesTable = pgTable("global_files", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  url: varchar("url", { length: 1024 }).notNull(),
  contentType: varchar("content_type", { length: 128 }),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

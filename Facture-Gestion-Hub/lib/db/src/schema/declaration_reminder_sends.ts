import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const declarationReminderSendsTable = pgTable(
  "declaration_reminder_sends",
  {
    id: serial("id").primaryKey(),
    channel: text("channel").notNull(), // e.g. "whatsapp"
    quarter: text("quarter").notNull(), // T1|T2|T3|T4
    quarterYear: integer("quarter_year").notNull(), // year of the quarter period (T4 is previous year)
    daysBeforeDeadline: integer("days_before_deadline").notNull(), // 10 or 5
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("declaration_reminder_sends_unique").on(
      t.channel,
      t.quarter,
      t.quarterYear,
      t.daysBeforeDeadline,
    ),
  }),
);

export const insertDeclarationReminderSendSchema = createInsertSchema(
  declarationReminderSendsTable,
).omit({ id: true, sentAt: true });

export type InsertDeclarationReminderSend = z.infer<
  typeof insertDeclarationReminderSendSchema
>;
export type DeclarationReminderSend =
  typeof declarationReminderSendsTable.$inferSelect;


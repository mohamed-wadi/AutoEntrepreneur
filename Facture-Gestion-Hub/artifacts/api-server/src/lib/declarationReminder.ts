import { logger } from "./logger";
import { db, declarationReminderSendsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import cron from "node-cron";
import { DateTime } from "luxon";

type Quarter = "T1" | "T2" | "T3" | "T4";

const DEFAULT_WHATSAPP_RECIPIENTS = ["212688076617"];

function getCurrentQuarter(monthIndex: number): Quarter {
  if (monthIndex <= 2) return "T1";
  if (monthIndex <= 5) return "T2";
  if (monthIndex <= 8) return "T3";
  return "T4";
}

function getPreviousQuarter(quarter: Quarter): Quarter {
  if (quarter === "T1") return "T4";
  if (quarter === "T2") return "T1";
  if (quarter === "T3") return "T2";
  return "T3";
}

/**
 * `quarterYear` is the year of the quarter period:
 * - T1/T2/T3 deadlines are within quarterYear
 * - T4 deadline is Jan 31 of quarterYear+1
 */
function getDeclarationDeadline(quarterYear: number, quarter: Quarter): Date {
  if (quarter === "T1") return new Date(quarterYear, 3, 30, 23, 59, 59, 999);
  if (quarter === "T2") return new Date(quarterYear, 6, 31, 23, 59, 59, 999);
  if (quarter === "T3") return new Date(quarterYear, 9, 31, 23, 59, 59, 999);
  return new Date(quarterYear + 1, 0, 31, 23, 59, 59, 999);
}

function getReminderTarget(now: Date): { quarter: Quarter; quarterYear: number; deadline: Date } {
  const currentQuarter = getCurrentQuarter(now.getMonth());
  const targetQuarter = getPreviousQuarter(currentQuarter);
  const quarterYear = currentQuarter === "T1" ? now.getFullYear() - 1 : now.getFullYear();
  const deadline = getDeclarationDeadline(quarterYear, targetQuarter);
  return { quarter: targetQuarter, quarterYear, deadline };
}

function nowInCasablanca(): Date {
  return DateTime.now().setZone("Africa/Casablanca").toJSDate();
}

function daysUntil(date: Date, now: Date): number {
  const d1 = new Date(date);
  const d2 = new Date(now);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return Math.floor((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
}

function getWhatsAppRecipients(): string[] {
  const raw = process.env["DECLARATION_REMINDER_WHATSAPP_TO"]?.trim();
  const values = (raw ? raw.split(",") : DEFAULT_WHATSAPP_RECIPIENTS)
    .map((v) => v.trim())
    .filter(Boolean);

  return values
    .map((phone) => phone.replace(/\D/g, ""))
    .filter((phone) => phone.startsWith("212") && phone.length === 12);
}

async function sendReminderWhatsApp(now: Date, quarter: Quarter, deadline: Date): Promise<void> {
  const enabled = (process.env["WHATSAPP_ENABLED"] ?? "false").toLowerCase() === "true";
  if (!enabled) {
    return;
  }

  const token = process.env["WHATSAPP_ACCESS_TOKEN"]?.trim();
  const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"]?.trim();
  const apiVersion = process.env["WHATSAPP_API_VERSION"]?.trim() || "v22.0";
  const recipients = getWhatsAppRecipients();

  if (!token || !phoneNumberId) {
    logger.warn("Declaration reminder WhatsApp not sent: WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID are required");
    return;
  }
  if (recipients.length === 0) {
    logger.warn("Declaration reminder WhatsApp not sent: no recipients configured");
    return;
  }

  const deadlineLabel = deadline.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
  });
  const remainingDays = daysUntil(deadline, now);
  const dayLabel = remainingDays === 1 ? "jour" : "jours";
  const message = [
    `Rappel déclaration ${quarter}`,
    `À déclarer avant le ${deadlineLabel}`,
    `Il vous reste ${remainingDays} ${dayLabel}`,
    "https://rn.ae.gov.ma/login",
  ].join("\n");

  for (const to of recipients) {
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: {
            preview_url: true,
            body: message,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WhatsApp send failed for ${to}: ${response.status} ${errorBody}`);
    }
  }

  logger.info(
    {
      quarter,
      recipients,
      remainingDays,
      deadline: deadline.toISOString(),
    },
    "Declaration reminder WhatsApp sent",
  );
}

async function sendReminderWhatsAppWithRetry(now: Date, quarter: Quarter, deadline: Date): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await sendReminderWhatsApp(now, quarter, deadline);
      return;
    } catch (err) {
      lastErr = err;
      logger.warn({ err, attempt }, "Declaration reminder WhatsApp attempt failed");
      const delayMs = 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function checkAndSendDeclarationReminder(): Promise<void> {
  const now = nowInCasablanca();
  const { quarter, quarterYear, deadline } = getReminderTarget(now);
  const remainingDays = daysUntil(deadline, now);

  if (remainingDays !== 10 && remainingDays !== 5) {
    logger.debug({ remainingDays }, "Skipping reminder (not 10 or 5 days)");
    return;
  }

  try {
    // Race-safe anti-spam: rely on DB unique constraint.
    // Insert first (reservation). If duplicate => already sent/reserved.
    let reservationId: number | null = null;
    try {
      const inserted = await db
        .insert(declarationReminderSendsTable)
        .values({
          channel: "whatsapp",
          quarter,
          quarterYear,
          daysBeforeDeadline: remainingDays,
          deadlineAt: deadline,
        })
        .returning({ id: declarationReminderSendsTable.id });
      if (!inserted[0]?.id) {
        throw new Error("Failed to create reservation id");
      }
      reservationId = inserted[0].id;
    } catch (err) {
      // Duplicate key => already handled by another run/instance.
      logger.info({ quarter, quarterYear, remainingDays }, "Declaration reminder already recorded");
      return;
    }

    try {
      await sendReminderWhatsAppWithRetry(now, quarter, deadline);
    } catch (err) {
      // If send fails, remove reservation so next run can retry.
      if (reservationId) {
        await db
          .delete(declarationReminderSendsTable)
          .where(eq(declarationReminderSendsTable.id, reservationId));
      }
      throw err;
    }
  } catch (err) {
    logger.error({ err }, "Declaration reminder WhatsApp failed");
    return;
  }
}

export function startDeclarationReminderJob(): void {
  const run = () =>
    void checkAndSendDeclarationReminder().catch((err) => {
      logger.error({ err }, "Scheduled declaration reminder check failed");
    });

  // Run once on startup (avoid double-run if starting close to 09:00).
  const startupNow = nowInCasablanca();
  if (startupNow.getHours() >= 9) {
    run();
  }

  // Run every day at 09:00 Morocco time.
  cron.schedule("0 9 * * *", run, { timezone: "Africa/Casablanca" });
}

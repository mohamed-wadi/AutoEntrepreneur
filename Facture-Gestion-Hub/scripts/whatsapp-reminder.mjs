const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || "v25.0";
const rawRecipients = process.env.DECLARATION_REMINDER_WHATSAPP_TO?.trim() || "";
const dryRun = (process.env.DRY_RUN ?? "false").toLowerCase() === "true";
const forceSend = (process.env.FORCE_SEND ?? "false").toLowerCase() === "true";

const recipients = rawRecipients
  .split(",")
  .map((v) => v.trim().replace(/\D/g, ""))
  .filter((v) => v.startsWith("212") && v.length === 12);

if (!token || !phoneNumberId) {
  console.error("Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
  process.exit(1);
}
if (recipients.length === 0) {
  console.error("No valid DECLARATION_REMINDER_WHATSAPP_TO recipients");
  process.exit(1);
}

function getCurrentQuarter(monthIndex) {
  if (monthIndex <= 2) return "T1";
  if (monthIndex <= 5) return "T2";
  if (monthIndex <= 8) return "T3";
  return "T4";
}

function getPreviousQuarter(quarter) {
  if (quarter === "T1") return "T4";
  if (quarter === "T2") return "T1";
  if (quarter === "T3") return "T2";
  return "T3";
}

function getDeclarationDeadline(quarterYear, quarter) {
  if (quarter === "T1") return new Date(Date.UTC(quarterYear, 3, 30, 23, 59, 59, 999));
  if (quarter === "T2") return new Date(Date.UTC(quarterYear, 6, 31, 23, 59, 59, 999));
  if (quarter === "T3") return new Date(Date.UTC(quarterYear, 9, 31, 23, 59, 59, 999));
  return new Date(Date.UTC(quarterYear + 1, 0, 31, 23, 59, 59, 999));
}

function daysUntil(deadline, now) {
  const d1 = new Date(deadline);
  const d2 = new Date(now);
  d1.setUTCHours(0, 0, 0, 0);
  d2.setUTCHours(0, 0, 0, 0);
  return Math.floor((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
}

function nowInCasablancaParts() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function buildReminderTarget(nowCasablancaDate) {
  const currentQuarter = getCurrentQuarter(nowCasablancaDate.getMonth());
  const targetQuarter = getPreviousQuarter(currentQuarter);
  const quarterYear =
    currentQuarter === "T1" ? nowCasablancaDate.getFullYear() - 1 : nowCasablancaDate.getFullYear();
  const deadline = getDeclarationDeadline(quarterYear, targetQuarter);
  return { quarter: targetQuarter, deadline };
}

async function sendWhatsAppText(to, body) {
  if (dryRun) {
    console.log("[DRY_RUN] Would send", { to, body });
    return;
  }

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
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
        body,
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`WhatsApp API error ${response.status}: ${raw}`);
  }
  console.log("WHATSAPP_SENT", raw);
}

async function main() {
  // Run hourly but send only around 09:00 Morocco time.
  const nowMz = nowInCasablancaParts();
  if (!forceSend && nowMz.hour !== 9) {
    console.log("Skip: not 09:xx in Casablanca", nowMz);
    return;
  }

  const nowCasablancaDate = new Date(
    `${nowMz.year}-${String(nowMz.month).padStart(2, "0")}-${String(nowMz.day).padStart(2, "0")}T12:00:00`,
  );

  const { quarter, deadline } = buildReminderTarget(nowCasablancaDate);
  const remainingDays = daysUntil(deadline, new Date());
  if (!forceSend && remainingDays !== 10 && remainingDays !== 5) {
    console.log("Skip: remainingDays is not 10 or 5", { remainingDays, quarter, deadline: deadline.toISOString() });
    return;
  }

  const deadlineLabel = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Casablanca",
    day: "2-digit",
    month: "long",
  }).format(deadline);
  const dayLabel = remainingDays === 1 ? "jour" : "jours";
  const body = [
    `Rappel déclaration ${quarter}`,
    `À déclarer avant le ${deadlineLabel}`,
    `Il vous reste ${remainingDays} ${dayLabel}`,
    "https://rn.ae.gov.ma/login",
  ].join("\n");

  for (const to of recipients) {
    await sendWhatsAppText(to, body);
  }
}

main().catch((err) => {
  console.error("FAILED", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

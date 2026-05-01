const enabled = (process.env.WHATSAPP_ENABLED ?? "false").toLowerCase() === "true";
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const apiVersion = process.env.WHATSAPP_API_VERSION ?? "v22.0";
const to = (process.env.DECLARATION_REMINDER_WHATSAPP_TO ?? "212688076617")
  .split(",")[0]
  .trim()
  .replace(/\D/g, "");

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
  if (quarter === "T1") return new Date(quarterYear, 3, 30, 23, 59, 59, 999);
  if (quarter === "T2") return new Date(quarterYear, 6, 31, 23, 59, 59, 999);
  if (quarter === "T3") return new Date(quarterYear, 9, 31, 23, 59, 59, 999);
  return new Date(quarterYear + 1, 0, 31, 23, 59, 59, 999);
}

function getReminderTarget(now) {
  const currentQuarter = getCurrentQuarter(now.getMonth());
  const targetQuarter = getPreviousQuarter(currentQuarter);
  const quarterYear = currentQuarter === "T1" ? now.getFullYear() - 1 : now.getFullYear();
  const deadline = getDeclarationDeadline(quarterYear, targetQuarter);
  return { quarter: targetQuarter, quarterYear, deadline };
}

function daysUntil(date, now) {
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

if (!enabled) {
  console.error("WHATSAPP_ERROR WHATSAPP_ENABLED=false");
  process.exit(1);
}
if (!token || !phoneNumberId) {
  console.error("WHATSAPP_ERROR Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
  process.exit(1);
}

const fakeNow = process.env.TEST_NOW ? new Date(process.env.TEST_NOW) : new Date();
const forcedQuarter = process.env.TEST_FORCE_TARGET_QUARTER;
const forcedYearRaw = process.env.TEST_FORCE_TARGET_YEAR;
const forcedYear = forcedYearRaw ? Number.parseInt(forcedYearRaw, 10) : fakeNow.getFullYear();

console.log("TEST_VARS", {
  TEST_NOW: process.env.TEST_NOW,
  TEST_FORCE_TARGET_QUARTER: forcedQuarter,
  TEST_FORCE_TARGET_YEAR: forcedYearRaw,
});

const { quarter, deadline } =
  forcedQuarter && ["T1", "T2", "T3", "T4"].includes(forcedQuarter)
    ? { quarter: forcedQuarter, deadline: getDeclarationDeadline(forcedYear, forcedQuarter) }
    : getReminderTarget(fakeNow);
const remainingDays = daysUntil(deadline, fakeNow);
const deadlineLabel = deadline.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" });
const body = [
  `Rappel déclaration ${quarter}`,
  `À déclarer avant le ${deadlineLabel}`,
  `Il vous reste ${remainingDays} ${remainingDays === 1 ? "jour" : "jours"}`,
  "https://rn.ae.gov.ma/login",
].join("\n");

const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
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

if (!res.ok) {
  console.error(`WHATSAPP_ERROR ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log("WHATSAPP_SENT", await res.text());
console.log("WHATSAPP_BODY", body);

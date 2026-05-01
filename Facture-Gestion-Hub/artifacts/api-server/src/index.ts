import app from "./app";
import { logger } from "./lib/logger";
import { seedDatabase } from "./lib/seed";
import { startDeclarationReminderJob } from "./lib/declarationReminder";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Seed database with initial data
  seedDatabase().catch((e) => {
    logger.error({ err: e }, "Failed to seed database");
  });

  const localReminderEnabled =
    (process.env["ENABLE_LOCAL_REMINDER_JOB"] ?? "false").toLowerCase() ===
    "true";

  if (localReminderEnabled) {
    startDeclarationReminderJob();
    logger.info("Local reminder job enabled");
  } else {
    logger.info("Local reminder job disabled (cloud-only mode)");
  }
});

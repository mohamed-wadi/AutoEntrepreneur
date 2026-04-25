import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/db-check", async (_req, res) => {
  const rawUrl = process.env.DATABASE_URL || "";
  let parsedUser: string | null = null;
  let parsedHost: string | null = null;
  let parsedDb: string | null = null;
  try {
    if (rawUrl) {
      const u = new URL(rawUrl);
      parsedUser = u.username || null;
      parsedHost = u.hostname || null;
      parsedDb = u.pathname?.replace(/^\/+/, "") || null;
    }
  } catch {
    // ignore URL parse errors; we still return DB error below
  }

  try {
    const result = await pool.query("select 1 as ok");
    res.json({
      ok: true,
      rowCount: result.rowCount,
      dbUser: parsedUser,
      dbHost: parsedHost,
      dbName: parsedDb,
    });
  } catch (err) {
    const asAny = err as { code?: string; message?: string };
    res.status(500).json({
      ok: false,
      code: asAny?.code ?? null,
      message: asAny?.message ?? "Unknown DB error",
      dbUser: parsedUser,
      dbHost: parsedHost,
      dbName: parsedDb,
    });
  }
});

export default router;

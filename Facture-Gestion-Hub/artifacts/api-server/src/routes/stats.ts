import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { invoicesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { GetStatsQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const IMPOTS_RATE = 0.01;
const CNSS_RATE = 0.0226;

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function computeCnss(quarterlyCA: number): number {
  if (quarterlyCA <= 0) return 0;
  return Math.round(quarterlyCA * CNSS_RATE * 100) / 100;
}

const router: IRouter = Router();

router.get("/stats", requireAuth, async (req, res): Promise<void> => {
  const params = GetStatsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const year = params.data.year ?? new Date().getFullYear();

  const [totals] = await db
    .select({
      totalMontantAnnuel: sql<string>`COALESCE(SUM(${invoicesTable.montantDh}), 0)`,
      totalInvoices: sql<number>`COUNT(*)`,
      unpaidCount: sql<number>`SUM(CASE WHEN ${invoicesTable.statut} = 'en_attente' THEN 1 ELSE 0 END)`,
    })
    .from(invoicesTable)
    .where(eq(invoicesTable.year, year));

  const byTrimestreRows = await db
    .select({
      trimestre: invoicesTable.trimestre,
      totalMontant: sql<string>`COALESCE(SUM(${invoicesTable.montantDh}), 0)`,
      totalInvoices: sql<number>`COUNT(*)`,
      paidCount: sql<number>`SUM(CASE WHEN ${invoicesTable.statut} IN ('paye', 'regle') THEN 1 ELSE 0 END)`,
      pendingCount: sql<number>`SUM(CASE WHEN ${invoicesTable.statut} = 'en_attente' THEN 1 ELSE 0 END)`,
    })
    .from(invoicesTable)
    .where(eq(invoicesTable.year, year))
    .groupBy(invoicesTable.trimestre)
    .orderBy(invoicesTable.trimestre);

  const allTrimes = ["T1", "T2", "T3", "T4"];
  const trimestreMap = Object.fromEntries(byTrimestreRows.map((r) => [r.trimestre, r]));

  const byTrimestre = allTrimes.map((t) => {
    const row = trimestreMap[t];
    return {
      trimestre: t,
      totalMontant: row ? toFiniteNumber(row.totalMontant, 0) : 0,
      totalInvoices: row ? toFiniteNumber(row.totalInvoices, 0) : 0,
      paidCount: row ? toFiniteNumber(row.paidCount, 0) : 0,
      pendingCount: row ? toFiniteNumber(row.pendingCount, 0) : 0,
    };
  });

  const totalMontantAnnuel = totals ? toFiniteNumber(totals.totalMontantAnnuel, 0) : 0;
  const totalCnssAnnuel = byTrimestre.reduce((sum, t) => sum + computeCnss(t.totalMontant), 0);

  res.json({
    year,
    totalMontantAnnuel,
    totalInvoices: totals ? toFiniteNumber(totals.totalInvoices, 0) : 0,
    unpaidCount: totals ? toFiniteNumber(totals.unpaidCount, 0) : 0,
    totalImpotsAnnuel: Math.round(toFiniteNumber(totalMontantAnnuel, 0) * IMPOTS_RATE * 100) / 100,
    totalCnssAnnuel,
    byTrimestre,
  });
});

export default router;

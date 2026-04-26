import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { invoicesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { ListDeclarationsQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const IMPOTS_RATE = 0.01; // 1%
const CNSS_RATE = 0.0226;

function computeCnss(quarterlyCA: number): number {
  if (quarterlyCA <= 0) return 0;
  return Math.round(quarterlyCA * CNSS_RATE * 100) / 100;
}

const router: IRouter = Router();

router.get("/declarations", requireAuth, async (req, res): Promise<void> => {
  const params = ListDeclarationsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const year = params.data.year ?? new Date().getFullYear();

  const rows = await db
    .select({
      trimestre: invoicesTable.trimestre,
      totalMontant: sql<string>`COALESCE(SUM(${invoicesTable.montantDh}), 0)`,
      totalInvoices: sql<number>`COUNT(*)`,
      paidInvoices: sql<number>`SUM(CASE WHEN ${invoicesTable.statut} IN ('paye', 'regle') THEN 1 ELSE 0 END)`,
      pendingInvoices: sql<number>`SUM(CASE WHEN ${invoicesTable.statut} = 'en_attente' THEN 1 ELSE 0 END)`,
      dateDeclaration: sql<string | null>`MAX(${invoicesTable.dateDeclaration})`,
    })
    .from(invoicesTable)
    .where(eq(invoicesTable.year, year))
    .groupBy(invoicesTable.trimestre)
    .orderBy(invoicesTable.trimestre);

  const allTrimes = ["T1", "T2", "T3", "T4"];
  const rowMap = Object.fromEntries(rows.map((r) => [r.trimestre, r]));

  const declarations = allTrimes.map((t) => {
    const row = rowMap[t];
    const totalMontant = row ? Number(row.totalMontant) : 0;
    return {
      trimestre: t,
      year,
      totalMontant,
      totalInvoices: row ? Number(row.totalInvoices) : 0,
      paidInvoices: row ? Number(row.paidInvoices) : 0,
      pendingInvoices: row ? Number(row.pendingInvoices) : 0,
      impotsAPayer: Math.round(totalMontant * IMPOTS_RATE * 100) / 100,
      cnssAPayer: computeCnss(totalMontant),
      dateDeclaration: row?.dateDeclaration ?? null,
    };
  });

  res.json(declarations);
});

export default router;

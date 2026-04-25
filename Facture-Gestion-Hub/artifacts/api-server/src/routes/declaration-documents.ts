import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { declarationDocumentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/declaration-documents", requireAuth, async (req, res): Promise<void> => {
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  const trimestre = req.query.trimestre as string | undefined;

  const conditions: ReturnType<typeof eq>[] = [eq(declarationDocumentsTable.year, year)];
  if (trimestre) {
    conditions.push(eq(declarationDocumentsTable.trimestre, trimestre));
  }

  const docs = await db
    .select()
    .from(declarationDocumentsTable)
    .where(and(...conditions))
    .orderBy(declarationDocumentsTable.createdAt);

  res.json(docs);
});

router.post("/declaration-documents", requireAdmin, async (req, res): Promise<void> => {
  const { trimestre, year, fileUrl, fileName } = req.body as {
    trimestre?: string;
    year?: number;
    fileUrl?: string;
    fileName?: string;
  };

  if (
    !trimestre ||
    !["T1", "T2", "T3", "T4"].includes(trimestre) ||
    !year ||
    typeof year !== "number" ||
    !fileUrl ||
    typeof fileUrl !== "string" ||
    !fileName ||
    typeof fileName !== "string"
  ) {
    res.status(400).json({ error: "Données invalides" });
    return;
  }

  const [doc] = await db
    .insert(declarationDocumentsTable)
    .values({ trimestre, year, fileUrl, fileName })
    .returning();

  res.status(201).json(doc);
});

router.delete("/declaration-documents/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ error: "ID invalide" });
    return;
  }

  await db.delete(declarationDocumentsTable).where(eq(declarationDocumentsTable.id, id));
  res.json({ success: true });
});

export default router;

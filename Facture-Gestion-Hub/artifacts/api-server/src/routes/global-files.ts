import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { globalFilesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import * as zod from "zod";

const router: IRouter = Router();

const FileBody = zod.object({
    name: zod.string(),
    url: zod.string(),
    contentType: zod.string().nullish(),
});

// List all files
router.get("/global-files", requireAuth, async (req, res) => {
    const files = await db.select().from(globalFilesTable).orderBy(desc(globalFilesTable.uploadedAt));
    res.json(files);
    return;
});

// Add a file record
router.post("/global-files", requireAdmin, async (req, res) => {
    const parsed = FileBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const [file] = await db.insert(globalFilesTable).values(parsed.data).returning();
    res.status(201).json(file);
    return;
});

// Delete a file record
router.delete("/global-files/:id", requireAdmin, async (req, res) => {
    const rawId = req.params.id;
    const id = parseInt(Array.isArray(rawId) ? rawId[0] : rawId);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const [file] = await db.delete(globalFilesTable).where(eq(globalFilesTable.id, id)).returning();
    if (!file) return res.status(404).json({ error: "Fichier introuvable" });
    res.sendStatus(204);
    return;
});

export default router;

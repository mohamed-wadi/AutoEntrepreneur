import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { catalogsTable } from "@workspace/db";
import { eq, desc, ilike } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import * as zod from "zod";

const router: IRouter = Router();

// Zod schemas for validation
const CatalogBody = zod.object({
    name: zod.string(),
    description: zod.string().nullish(),
    duration: zod.string().nullish(),
    price: zod.string().nullish(),
});

const CatalogParams = zod.object({
    id: zod.coerce.number(),
});


// List all catalog items
router.get("/catalogs", requireAuth, async (req, res) => {
    const items = await db.select().from(catalogsTable).orderBy(desc(catalogsTable.createdAt));
    res.json(items);
    return;
});

// Create catalog item
router.post("/catalogs", requireAdmin, async (req, res) => {
    const parsed = CatalogBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const existing = await db.select().from(catalogsTable).where(ilike(catalogsTable.name, parsed.data.name));
    if (existing.length > 0) return res.status(400).json({ error: "Une formation avec ce nom existe déjà" });

    const [item] = await db.insert(catalogsTable).values(parsed.data).returning();
    res.status(201).json(item);
    return;
});

// Update catalog item
router.patch("/catalogs/:id", requireAdmin, async (req, res) => {
    const params = CatalogParams.safeParse(req.params);
    if (!params.success) return res.status(400).json({ error: params.error.message });

    const parsed = CatalogBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const existing = await db.select().from(catalogsTable).where(ilike(catalogsTable.name, parsed.data.name));
    if (existing.length > 0 && existing[0].id !== params.data.id) {
        return res.status(400).json({ error: "Une formation avec ce nom existe déjà" });
    }

    const [item] = await db.update(catalogsTable)
        .set(parsed.data)
        .where(eq(catalogsTable.id, params.data.id))
        .returning();

    if (!item) return res.status(404).json({ error: "Formation introuvable" });
    res.json(item);
    return;
});

// Delete catalog item
router.delete("/catalogs/:id", requireAdmin, async (req, res) => {
    const params = CatalogParams.safeParse(req.params);
    if (!params.success) return res.status(400).json({ error: params.error.message });

    const [item] = await db.delete(catalogsTable).where(eq(catalogsTable.id, params.data.id)).returning();
    if (!item) return res.status(404).json({ error: "Formation introuvable" });
    res.sendStatus(204);
    return;
});

export default router;

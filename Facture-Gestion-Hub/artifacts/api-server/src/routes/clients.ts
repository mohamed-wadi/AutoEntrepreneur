import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { clientsTable, cabinetFilesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateClientBody,
  UpdateClientBody,
  GetClientParams,
  UpdateClientParams,
  DeleteClientParams,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import * as zod from "zod";

const router: IRouter = Router();
const CabinetFileBody = zod.object({
  name: zod.string().min(1),
  url: zod.string().min(1),
  contentType: zod.string().nullable().optional(),
});

router.get("/clients", requireAuth, async (req, res): Promise<void> => {
  const clients = await db.select().from(clientsTable).orderBy(clientsTable.name);
  res.json(clients);
});

router.post("/clients", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [client] = await db.insert(clientsTable).values(parsed.data).returning();
  res.status(201).json(client);
});

router.get("/clients/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.id));
  if (!client) {
    res.status(404).json({ error: "Client introuvable" });
    return;
  }
  res.json(client);
});

router.patch("/clients/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [client] = await db.update(clientsTable).set(parsed.data).where(eq(clientsTable.id, params.data.id)).returning();
  if (!client) {
    res.status(404).json({ error: "Client introuvable" });
    return;
  }
  res.json(client);
});

router.delete("/clients/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(cabinetFilesTable).where(eq(cabinetFilesTable.clientId, params.data.id));
  const [client] = await db.delete(clientsTable).where(eq(clientsTable.id, params.data.id)).returning();
  if (!client) {
    res.status(404).json({ error: "Client introuvable" });
    return;
  }
  res.sendStatus(204);
});

router.get("/clients/:id/files", requireAuth, async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const files = await db
    .select()
    .from(cabinetFilesTable)
    .where(eq(cabinetFilesTable.clientId, params.data.id))
    .orderBy(desc(cabinetFilesTable.uploadedAt));
  res.json(files);
});

router.get("/cabinet-files", requireAuth, async (_req, res): Promise<void> => {
  const files = await db.select().from(cabinetFilesTable).orderBy(desc(cabinetFilesTable.uploadedAt));
  res.json(files);
});

router.post("/clients/:id/files", requireAdmin, async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = CabinetFileBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [file] = await db
    .insert(cabinetFilesTable)
    .values({
      clientId: params.data.id,
      name: body.data.name,
      url: body.data.url,
      contentType: body.data.contentType ?? null,
    })
    .returning();
  res.status(201).json(file);
});

router.delete("/clients/:id/files/:fileId", requireAdmin, async (req, res): Promise<void> => {
  const params = zod
    .object({ id: zod.coerce.number(), fileId: zod.coerce.number() })
    .safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(cabinetFilesTable)
    .where(
      and(
        eq(cabinetFilesTable.id, params.data.fileId),
        eq(cabinetFilesTable.clientId, params.data.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Fichier introuvable" });
    return;
  }
  res.sendStatus(204);
});

export default router;

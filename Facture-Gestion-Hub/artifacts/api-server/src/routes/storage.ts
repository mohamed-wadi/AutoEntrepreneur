import express, { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import fs from "fs";
import { RequestUploadUrlBody } from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

function guessContentTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * Requires authenticated session — only logged-in users may upload files.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    if (objectStorageService.isLocalStorage()) {
      const { uploadURL, objectPath } = objectStorageService.prepareLocalUpload();
      res.json({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      });
      return;
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json({
      uploadURL,
      objectPath,
      metadata: { name, size, contentType },
    });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Failed to generate upload URL";
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /storage/local-upload/:id
 * Raw body = fichier (même flux que PUT vers GCS). Mode disque local uniquement.
 */
router.put(
  "/storage/local-upload/:id",
  requireAuth,
  express.raw({ type: "*/*", limit: "15mb" }),
  async (req: Request, res: Response): Promise<void> => {
    if (!objectStorageService.isLocalStorage()) {
      res.status(404).json({ error: "Local upload not enabled" });
      return;
    }
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId.join("/") : rawId;
    const body = req.body as Buffer | undefined;
    if (!body?.length) {
      res.status(400).json({ error: "Empty body" });
      return;
    }
    try {
      await objectStorageService.writeLocalUpload(id, body);
      res.sendStatus(204);
    } catch (err) {
      req.log.error({ err }, "Local upload failed");
      res.status(500).json({ error: "Failed to save file" });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve invoice PDF files.
 * Requires authenticated session — only logged-in users may access invoice files.
 * Optional ?filename=... query param sets the Content-Disposition header so the
 * browser downloads the file with the original name instead of the UUID path.
 * Add ?inline=1 (with or without filename) to use Content-Disposition: inline for
 * in-tab preview (PDF / images) instead of forcing download.
 */
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    if (objectStorageService.isLocalStorage()) {
      let abs: string;
      try {
        abs = objectStorageService.resolveLocalFileForObjectPath(objectPath);
      } catch {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      try {
        await fs.promises.access(abs);
      } catch {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      const st = await fs.promises.stat(abs);
      const desiredFilename = req.query.filename;
      const inline =
        req.query.inline === "1" ||
        req.query.inline === "true" ||
        req.query.disposition === "inline";
      const nameForType =
        typeof desiredFilename === "string"
          ? desiredFilename
          : wildcardPath.split("/").pop() ?? "";
      res.setHeader("Content-Type", guessContentTypeFromFileName(nameForType));
      res.setHeader("Content-Length", String(st.size));
      if (desiredFilename && typeof desiredFilename === "string") {
        const safe = desiredFilename.replace(/[^\w.\-\s()]/g, "_");
        res.setHeader(
          "Content-Disposition",
          inline
            ? `inline; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(desiredFilename)}`
            : `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(desiredFilename)}`,
        );
      } else if (inline) {
        res.setHeader("Content-Disposition", "inline");
      }
      fs.createReadStream(abs).pipe(res);
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    const desiredFilename = req.query.filename;
    const inline =
      req.query.inline === "1" ||
      req.query.inline === "true" ||
      req.query.disposition === "inline";
    if (desiredFilename && typeof desiredFilename === "string") {
      const safe = desiredFilename.replace(/[^\w.\-\s()]/g, "_");
      res.setHeader(
        "Content-Disposition",
        inline
          ? `inline; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(desiredFilename)}`
          : `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(desiredFilename)}`,
      );
    } else if (inline) {
      res.removeHeader("Content-Disposition");
      res.setHeader("Content-Disposition", "inline");
    }

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;

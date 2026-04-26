import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import QRCode from "qrcode";
import { decryptSecret, encryptSecret, generateTotpSecret, verifyTotp } from "../lib/twoFactor";

const router: IRouter = Router();
/** Mettre `DISABLE_2FA=true` pour couper toute la 2FA (urgence / maintenance). Sinon la 2FA est disponible. */
const OTP_DISABLED =
  process.env.DISABLE_2FA === "true" || process.env.DISABLE_2FA === "1";

const loginSchema = z.object({
  username: z
    .string()
    .min(1)
    .transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1),
  otp: z.string().trim().optional(),
});

const setupSchema = z.object({
  password: z.string().min(1),
});

const setupEnableSchema = z.object({
  otp: z.string().trim().min(6).max(8),
});

const disableSchema = z.object({
  password: z.string().min(1),
  otp: z.string().trim().min(6).max(8),
});

const updateProfileSchema = z.object({
  username: z
    .string()
    .min(1)
    .transform((s) => s.trim().toLowerCase()),
  avatarUrl: z
    .string()
    .trim()
    .refine(
      (value) =>
        value.length === 0 ||
        /^https?:\/\//i.test(value) ||
        value.startsWith("/api/storage/") ||
        value.startsWith("/objects/"),
      "avatarUrl invalide",
    )
    .optional(),
  password: z.string().min(1),
  otp: z.string().trim().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
  otp: z.string().trim().optional(),
});

function classifyAuthInfraError(err: unknown): string {
  const asAny = err as { code?: string; message?: string };
  const code = (asAny?.code || "").toString();
  const msg = (asAny?.message || "").toString().toLowerCase();

  if (code === "42P01" || msg.includes("relation") && msg.includes("does not exist")) {
    return "DB_SCHEMA_MISSING";
  }
  if (code === "28P01" || msg.includes("password authentication failed")) {
    return "DB_AUTH_FAILED";
  }
  if (code === "28000" || msg.includes("pg_hba.conf")) {
    return "DB_HBA_REJECTED";
  }
  if (code === "3D000" || msg.includes("database") && msg.includes("does not exist")) {
    return "DB_NOT_FOUND";
  }
  if (msg.includes("ssl") || msg.includes("no encryption")) {
    return "DB_SSL_REQUIRED";
  }
  if (msg.includes("enotfound") || msg.includes("getaddrinfo")) {
    return "DB_HOST_UNREACHABLE";
  }
  if (msg.includes("timeout") || msg.includes("econnrefused")) {
    return "DB_CONNECTION_FAILED";
  }
  return "AUTH_LOGIN_INTERNAL";
}

router.post("/auth/login", async (req, res): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Corps de requête invalide" });
      return;
    }

    const { username, password, otp } = parsed.data;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));

    if (!user) {
      res.status(401).json({ error: "Identifiants invalides" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Identifiants invalides" });
      return;
    }

    if (!OTP_DISABLED && user.twoFactorEnabled) {
      if (!user.twoFactorSecretEnc) {
        res.status(500).json({ error: "2FA activée mais secret manquant. Contactez l'administrateur." });
        return;
      }
      if (!otp) {
        res.status(401).json({ error: "Code OTP requis", code: "OTP_REQUIRED" });
        return;
      }
      const secret = decryptSecret(user.twoFactorSecretEnc);
      if (!verifyTotp(secret, otp)) {
        res.status(401).json({ error: "Code OTP invalide", code: "OTP_INVALID" });
        return;
      }
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role as "admin" | "viewer";

    res.json({ id: user.id, username: user.username, role: user.role, avatarUrl: user.avatarUrl });
  } catch (err) {
    const asAny = err as {
      code?: string;
      message?: string;
      cause?: { code?: string; message?: string };
    };
    const root = asAny?.cause ?? asAny;
    const reason = classifyAuthInfraError(root);
    req.log?.error({ err, reason }, "Auth login failed");
    res.status(500).json({
      error: "Erreur interne de connexion",
      reason,
      debugCode: root?.code ?? null,
      debugMessage: root?.message ?? null,
    });
  }
});

router.delete("/auth/logout", async (req, res): Promise<void> => {
  req.session.destroy(() => {
    res.sendStatus(204);
  });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));

  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Utilisateur introuvable" });
    return;
  }

  res.json({ id: user.id, username: user.username, role: user.role, avatarUrl: user.avatarUrl });
});

router.patch("/auth/profile", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Corps de requête invalide" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Utilisateur introuvable" });
    return;
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Mot de passe invalide" });
    return;
  }

  if (!OTP_DISABLED && user.twoFactorEnabled) {
    if (!user.twoFactorSecretEnc) {
      res.status(500).json({ error: "2FA activée mais secret manquant. Contactez l'administrateur." });
      return;
    }
    const otp = parsed.data.otp;
    if (!otp) {
      res.status(401).json({ error: "Code OTP requis", code: "OTP_REQUIRED" });
      return;
    }
    const secret = decryptSecret(user.twoFactorSecretEnc);
    if (!verifyTotp(secret, otp)) {
      res.status(401).json({ error: "Code OTP invalide", code: "OTP_INVALID" });
      return;
    }
  }

  try {
    const [updated] = await db
      .update(usersTable)
      .set({
        username: parsed.data.username,
        avatarUrl: parsed.data.avatarUrl?.trim() ? parsed.data.avatarUrl.trim() : null,
      })
      .where(eq(usersTable.id, user.id))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Impossible de modifier le profil" });
      return;
    }

    req.session.username = updated.username;
    res.json({ id: updated.id, username: updated.username, role: updated.role, avatarUrl: updated.avatarUrl });
  } catch {
    res.status(409).json({ error: "Nom déjà utilisé" });
  }
});

router.post("/auth/change-password", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Corps de requête invalide",
      details: parsed.error.issues.map((i) => i.message).join(", "),
    });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Utilisateur introuvable" });
    return;
  }

  const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Mot de passe invalide" });
    return;
  }

  if (!OTP_DISABLED && user.twoFactorEnabled) {
    if (!user.twoFactorSecretEnc) {
      res.status(500).json({ error: "2FA activée mais secret manquant. Contactez l'administrateur." });
      return;
    }
    const otp = parsed.data.otp;
    if (!otp) {
      res.status(401).json({ error: "Code OTP requis", code: "OTP_REQUIRED" });
      return;
    }
    const secret = decryptSecret(user.twoFactorSecretEnc);
    if (!verifyTotp(secret, otp)) {
      res.status(401).json({ error: "Code OTP invalide", code: "OTP_INVALID" });
      return;
    }
  }

  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, user.id));
  res.json({ ok: true });
});

router.get("/auth/2fa/status", async (req, res): Promise<void> => {
  if (OTP_DISABLED) {
    res.json({ enabled: false, disabledByServer: true });
    return;
  }
  if (!req.session.userId) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Utilisateur introuvable" });
    return;
  }
  res.json({ enabled: Boolean(user.twoFactorEnabled) });
});

router.post("/auth/2fa/setup", async (req, res): Promise<void> => {
  if (OTP_DISABLED) {
    res.status(503).json({ error: "2FA est temporairement désactivée par le serveur" });
    return;
  }
  if (!req.session.userId) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Corps de requête invalide" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Utilisateur introuvable" });
    return;
  }
  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Mot de passe invalide" });
    return;
  }

  const { secret, otpauth } = generateTotpSecret(user.username);
  const qrDataUrl = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });

  await db
    .update(usersTable)
    .set({
      twoFactorTempSecretEnc: encryptSecret(secret),
    })
    .where(eq(usersTable.id, user.id));

  res.json({
    qrDataUrl,
    manualKey: secret,
  });
});

router.post("/auth/2fa/enable", async (req, res): Promise<void> => {
  if (OTP_DISABLED) {
    res.status(503).json({ error: "2FA est temporairement désactivée par le serveur" });
    return;
  }
  if (!req.session.userId) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const parsed = setupEnableSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Corps de requête invalide" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user || !user.twoFactorTempSecretEnc) {
    res.status(400).json({ error: "Initialisation 2FA absente. Relancez la configuration." });
    return;
  }
  const secret = decryptSecret(user.twoFactorTempSecretEnc);
  if (!verifyTotp(secret, parsed.data.otp)) {
    res.status(401).json({ error: "Code OTP invalide" });
    return;
  }

  await db
    .update(usersTable)
    .set({
      twoFactorEnabled: true,
      twoFactorSecretEnc: user.twoFactorTempSecretEnc,
      twoFactorTempSecretEnc: null,
    })
    .where(eq(usersTable.id, user.id));

  res.json({ enabled: true });
});

router.post("/auth/2fa/disable", async (req, res): Promise<void> => {
  if (OTP_DISABLED) {
    res.status(200).json({ enabled: false, disabledByServer: true });
    return;
  }
  if (!req.session.userId) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const parsed = disableSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Corps de requête invalide" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Utilisateur introuvable" });
    return;
  }
  const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!validPassword) {
    res.status(401).json({ error: "Mot de passe invalide" });
    return;
  }
  if (!user.twoFactorEnabled || !user.twoFactorSecretEnc) {
    res.status(400).json({ error: "2FA déjà désactivée" });
    return;
  }
  const secret = decryptSecret(user.twoFactorSecretEnc);
  if (!verifyTotp(secret, parsed.data.otp)) {
    res.status(401).json({ error: "Code OTP invalide" });
    return;
  }

  await db
    .update(usersTable)
    .set({
      twoFactorEnabled: false,
      twoFactorSecretEnc: null,
      twoFactorTempSecretEnc: null,
    })
    .where(eq(usersTable.id, user.id));

  res.json({ enabled: false });
});

export default router;

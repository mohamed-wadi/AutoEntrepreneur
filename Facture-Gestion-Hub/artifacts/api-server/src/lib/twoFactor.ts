import crypto from "node:crypto";
import { generateSecret, generateURI, verifySync } from "otplib";

const APP_ISSUER = "Facture Gestion Hub";

function getEncryptionKey(): Buffer {
  const raw = process.env.TWO_FACTOR_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TWO_FACTOR_ENCRYPTION_KEY is required in production");
    }
    return crypto.createHash("sha256").update("dev-only-insecure-key").digest();
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, encryptedB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !encryptedB64) {
    throw new Error("Invalid encrypted 2FA payload");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function generateTotpSecret(username: string): {
  secret: string;
  otpauth: string;
} {
  const secret = generateSecret({ length: 20 });
  const otpauth = generateURI({
    strategy: "totp",
    issuer: APP_ISSUER,
    label: username,
    secret,
    period: 30,
    digits: 6,
  });
  return { secret, otpauth };
}

export function verifyTotp(secret: string, token: string): boolean {
  const result = verifySync({
    strategy: "totp",
    secret,
    token,
    period: 30,
    digits: 6,
    epochTolerance: 30,
  });
  return Boolean(result.valid);
}


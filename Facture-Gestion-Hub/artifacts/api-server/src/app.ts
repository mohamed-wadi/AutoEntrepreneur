import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import router from "./routes";
import { logger } from "./lib/logger";

declare module "express-session" {
  interface SessionData {
    userId: number;
    username: string;
    role: "admin" | "viewer";
  }
}

const app: Express = express();
const isProduction = process.env.NODE_ENV === "production";

const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:19509")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function isDevLanOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(
    origin,
  );
}

/** Quick Tunnel (cloudflared --url) : origine HTTPS change a chaque lancement. */
function isTryCloudflareDevOrigin(origin: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(origin);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      // In local dev, allow common LAN origins so mobile/other devices can test.
      if (!isProduction && isDevLanOrigin(origin)) return callback(null, true);
      // Expose-site-internet-Cloudflare.bat : meme origine que la page, mais sous-domaine aleatoire.
      if (!isProduction && isTryCloudflareDevOrigin(origin)) return callback(null, true);
      callback(new Error("CORS origin not allowed"));
    },
    credentials: true,
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  if (isProduction) {
    throw new Error("SESSION_SECRET environment variable is required in production");
  } else {
    logger.warn("SESSION_SECRET not set — using ephemeral random secret (development only)");
  }
}

// Trust reverse proxy in production so secure cookies work behind HTTPS termination
if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(
  session({
    secret: sessionSecret ?? require("crypto").randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: isProduction ? "none" : "lax",
    },
  }),
);

app.use("/api", router);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const asAny = err as { code?: string; message?: string };
  const code = (asAny?.code || "").toString();
  const msg = (asAny?.message || "").toString().toLowerCase();

  let reason = "INTERNAL_ERROR";
  if (code === "28P01" || msg.includes("password authentication failed")) reason = "DB_AUTH_FAILED";
  else if (code === "28000" || msg.includes("pg_hba.conf")) reason = "DB_HBA_REJECTED";
  else if (code === "42P01" || (msg.includes("relation") && msg.includes("does not exist"))) reason = "DB_SCHEMA_MISSING";
  else if (code === "3D000" || (msg.includes("database") && msg.includes("does not exist"))) reason = "DB_NOT_FOUND";
  else if (msg.includes("ssl") || msg.includes("no encryption")) reason = "DB_SSL_REQUIRED";
  else if (msg.includes("enotfound") || msg.includes("getaddrinfo")) reason = "DB_HOST_UNREACHABLE";
  else if (msg.includes("timeout") || msg.includes("econnrefused")) reason = "DB_CONNECTION_FAILED";

  logger.error({ err, reason }, "Unhandled API error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Erreur interne serveur", reason });
});

export default app;

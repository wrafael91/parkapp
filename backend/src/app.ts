import express, { type Express } from "express";
import type { PrismaClient } from "./generated/prisma/client.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { requireAllowedOrigin } from "./middleware/origin.js";
import { createSessionRouter } from "./modules/accounts/session.routes.js";
import { createHealthRouter } from "./modules/health/health.routes.js";

export interface AppOptions {
  allowedOrigin: string;
}

export function createApp(prisma: PrismaClient, options: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  // Trust X-Forwarded-For and X-Forwarded-Proto only from Nginx on the local
  // interface, so req.ip is the client's address (A-25, arquitectura 6.3).
  app.set("trust proxy", "loopback");
  app.use("/api", requireAllowedOrigin(options.allowedOrigin));
  // Only JSON is read (docs/modelo-amenazas.md, 7.3, item 9). 10 kB is enough
  // for any request of the app; Nginx stops anything over 64 kB first.
  app.use(express.json({ limit: "10kb" }));
  app.use("/api/salud", createHealthRouter(prisma));
  app.use("/api/sesion", createSessionRouter(prisma));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

import express, { type Express } from "express";
import type { PrismaClient } from "./generated/prisma/client.js";
import { requireAllowedOrigin } from "./middleware/origin.js";
import { createHealthRouter } from "./modules/health/health.routes.js";

export interface AppOptions {
  allowedOrigin: string;
}

export function createApp(prisma: PrismaClient, options: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", requireAllowedOrigin(options.allowedOrigin));
  app.use("/api/salud", createHealthRouter(prisma));
  return app;
}

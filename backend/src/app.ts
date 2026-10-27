import express, { type Express } from "express";
import type { PrismaClient } from "./generated/prisma/client.js";
import { createHealthRouter } from "./modules/health/health.routes.js";

export function createApp(prisma: PrismaClient): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api/salud", createHealthRouter(prisma));
  return app;
}
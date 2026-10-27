import { Router } from "express";
import type { PrismaClient } from "../../generated/prisma/client.js";

export function createHealthRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ estado: "ok" });
    } catch (error) {
      console.error("Health check failed: database unreachable", error);
      res.status(503).json({ estado: "no_disponible" });
    }
  });

  return router;
}
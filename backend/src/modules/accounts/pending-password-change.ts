import type { RequestHandler } from "express";
import type { PrismaClient } from "../../generated/prisma/client.js";

export function rejectPendingPasswordChange(_prisma: PrismaClient): RequestHandler {
  return (_req, _res, next) => next();
}

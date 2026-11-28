import type { RequestHandler } from "express";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { sendError } from "../../middleware/errors.js";
import { readSessionToken } from "./session-cookie.js";
import { isSessionActive } from "./session-policy.js";
import { hashSessionToken } from "./session-token.js";

// RI-16 (requirements 1.3, decision 4): while a password someone else assigned
// has not been changed, every route mounted after this answers 403. It goes
// after /api/salud and /api/sesion, so the user can still see his session, sign
// out and change the password. It denies by default: a new route cannot forget
// it. Without an active session it does nothing, and the route answers 401.
export function rejectPendingPasswordChange(prisma: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    const token = readSessionToken(req.get("Cookie"));
    if (token !== null) {
      // Only reads: the route refreshes the last activity (NFR-04).
      const session = await prisma.$transaction((db) =>
        db.session.findUnique({
          where: { tokenHash: hashSessionToken(token) },
          include: { user: true },
        }),
      );
      if (
        session !== null &&
        isSessionActive(session, new Date()) &&
        session.user.active &&
        session.user.mustChangePassword
      ) {
        sendError(
          res,
          403,
          "CAMBIO_CONTRASENA_PENDIENTE",
          "Debes cambiar tu contraseña antes de continuar.",
        );
        return;
      }
    }
    next();
  };
}

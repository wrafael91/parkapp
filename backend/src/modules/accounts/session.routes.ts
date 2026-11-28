import { Router } from "express";
import { z } from "zod";
import type { PrismaClient, Role } from "../../generated/prisma/client.js";
import { sendError } from "../../middleware/errors.js";
import { changeOwnPassword } from "./change-password.js";
import { readSessionToken, SESSION_COOKIE, sessionCookieOptions } from "./session-cookie.js";
import { authenticate, signIn, signOut, type SessionUser } from "./session.service.js";

// ADR 0008: the contract is in Spanish, and this module translates it.
const signInBody = z.object({
  correo: z.string().min(1).max(254),
  // NFR-02: at most 64 characters, counted as in password.ts (code points).
  contrasena: z
    .string()
    .min(1)
    .refine((value) => [...value].length <= 64),
});

// US-05: the current password up to 64 characters, as in sign-in, and an
// unknown field is a 400. changeOwnPassword checks the new one (NFR-02).
const changePasswordBody = z.strictObject({
  actual: z
    .string()
    .min(1)
    .refine((value) => [...value].length <= 64),
  nueva: z.string(),
});

// The @map values of schema.prisma (ADR 0008, decision 4).
const ROLE_NAMES = {
  ADMINISTRATOR: "ADMINISTRADOR",
  OPERATOR: "OPERADOR",
} as const satisfies Record<Role, string>;

function toUsuario(user: SessionUser) {
  return {
    id: user.id,
    nombre: user.name,
    rol: ROLE_NAMES[user.role],
    debeCambiarContrasena: user.mustChangePassword,
  };
}

// The Origin check runs before these routes (app.ts), and each call to the
// service runs in its own transaction.
export function createSessionRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const body = signInBody.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, "ENTRADA_INVALIDA", "Los datos enviados no son válidos.");
      return;
    }
    const result = await prisma.$transaction((db) =>
      signIn(db, {
        email: body.data.correo,
        password: body.data.contrasena,
        ip: req.ip ?? "",
        now: new Date(),
      }),
    );
    if (!result.ok) {
      sendError(res, 401, "NO_AUTENTICADO", "Correo o contraseña incorrectos.");
      return;
    }
    res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions);
    res.status(200).json({ usuario: toUsuario(result.user) });
  });

  // The web app asks on load whether there is an active session.
  router.get("/", async (req, res) => {
    const token = readSessionToken(req.get("Cookie"));
    const user =
      token === null
        ? null
        : await prisma.$transaction((db) => authenticate(db, { token, now: new Date() }));
    if (user === null) {
      sendError(res, 401, "NO_AUTENTICADO", "No hay una sesión activa.");
      return;
    }
    res.status(200).json({ usuario: toUsuario(user) });
  });

  // FR-02: always 204. The cookie is cleared with the same attributes it was
  // set with, or the browser would keep it (docs/modelo-amenazas.md, 7.2).
  router.delete("/", async (req, res) => {
    const token = readSessionToken(req.get("Cookie"));
    if (token !== null) {
      await prisma.$transaction((db) => signOut(db, { token, now: new Date() }));
    }
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    res.status(204).end();
  });

  // US-05, FR-06: the signed-in user changes his own password, including the
  // mandatory change of RI-16. The other sessions end, and this one stays.
  router.post("/contrasena", async (req, res) => {
    const body = changePasswordBody.safeParse(req.body);
    const token = readSessionToken(req.get("Cookie"));
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const user = token === null ? null : await authenticate(db, { token, now });
      if (token === null || user === null) return { kind: "unauthenticated" } as const;
      if (!body.success) return { kind: "invalid" } as const;
      const result = await changeOwnPassword(db, {
        userId: user.id,
        token,
        currentPassword: body.data.actual,
        newPassword: body.data.nueva,
        ip: req.ip ?? "",
        now,
      });
      if (!result.ok) return { kind: result.reason } as const;
      return { kind: "changed", user: { ...user, mustChangePassword: false } } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", "No hay una sesión activa.");
        return;
      case "invalid":
      case "passwordLength":
        sendError(res, 400, "ENTRADA_INVALIDA", "Los datos enviados no son válidos.");
        return;
      // Not 401: the session is still valid, so the page does not sign out.
      case "wrongPassword":
        sendError(res, 400, "CONTRASENA_ACTUAL_INCORRECTA", "La contraseña actual no es correcta.");
        return;
      case "samePassword":
        sendError(
          res,
          400,
          "CONTRASENA_REPETIDA",
          "La contraseña nueva debe ser distinta de la actual.",
        );
        return;
      case "changed":
        res.status(200).json({ usuario: toUsuario(outcome.user) });
    }
  });

  return router;
}

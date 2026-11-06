import { Router } from "express";
import { z } from "zod";
import type { PrismaClient, Role } from "../../generated/prisma/client.js";
import { sendError } from "../../middleware/errors.js";
import { SESSION_COOKIE, sessionCookieOptions } from "./session-cookie.js";
import { signIn, type SessionUser } from "./session.service.js";

// ADR 0008: the contract is in Spanish, and this module translates it.
const signInBody = z.object({
  correo: z.string().min(1).max(254),
  // NFR-02: at most 64 characters, counted as in password.ts (code points).
  contrasena: z
    .string()
    .min(1)
    .refine((value) => [...value].length <= 64),
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

  return router;
}

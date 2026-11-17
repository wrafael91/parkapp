import { Router } from "express";
import { z } from "zod";
import type { PrismaClient, Role, User } from "../../generated/prisma/client.js";
import { sendError } from "../../middleware/errors.js";
import { authorizeAdministrator } from "./authorize.js";
import { createOperator, setAccountActive } from "./operator-accounts.js";

// The @map values of schema.prisma (ADR 0008, decision 4).
const ROLE_NAMES = {
  ADMINISTRATOR: "ADMINISTRADOR",
  OPERATOR: "OPERADOR",
} as const satisfies Record<Role, string>;

// ADR 0008: an account in Spanish, without its password hash or its sessions.
function toUsuario(user: User) {
  return {
    id: user.id,
    nombre: user.name,
    correo: user.email,
    rol: ROLE_NAMES[user.role],
    activa: user.active,
    creadaEn: user.createdAt.toISOString(),
  };
}

// US-02: there is no rol field, so only operators are created; an unknown field
// is a 400. createOperator checks the password length (NFR-02).
const createBody = z.strictObject({
  nombre: z.string().trim().min(1).max(100),
  correo: z.string().trim().pipe(z.email().max(254)),
  contrasena: z.string(),
});

// US-03: { activa: false } deactivates the account and { activa: true }
// reactivates it, as { activo: false } turns the period cap off.
const stateBody = z.strictObject({ activa: z.boolean() });

// An account id: a positive integer, without leading zeros, that fits in the
// INTEGER column. Anything else is a 400, not a database error.
const accountParams = z.object({
  id: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number)
    .refine((id) => id <= 2_147_483_647),
});

const NO_SESSION = "No hay una sesión activa.";
const NOT_ALLOWED = "No tienes permiso para esta acción.";
const INVALID = "Los datos enviados no son válidos.";

// The Origin check runs before these routes (app.ts). Each request runs in one
// transaction, and the response goes out after it commits, so a 403 is logged.
// Matrix 1.2: only an administrator manages the accounts.
export function createUsersRouter(prisma: PrismaClient): Router {
  const router = Router();

  // The accounts, oldest first, for the "Cuentas" section.
  router.get("/", async (req, res) => {
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const access = await authorizeAdministrator(db, req, now);
      if (access.kind !== "allowed") return access;
      const users = await db.user.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      return { kind: "listed", users } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", NO_SESSION);
        return;
      case "denied":
        sendError(res, 403, "ACCESO_DENEGADO", NOT_ALLOWED);
        return;
      case "listed":
        res.status(200).json({ usuarios: outcome.users.map(toUsuario) });
    }
  });

  // US-02, FR-03: a new operator account, with CUENTA_CREADA in the same
  // transaction.
  router.post("/", async (req, res) => {
    const body = createBody.safeParse(req.body);
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const access = await authorizeAdministrator(db, req, now);
      if (access.kind !== "allowed") return access;
      if (!body.success) return { kind: "invalid" } as const;
      const result = await createOperator(db, {
        name: body.data.nombre,
        email: body.data.correo,
        password: body.data.contrasena,
        now,
        createdBy: { userId: access.user.id, ip: req.ip ?? "" },
      });
      if (!result.ok) {
        return { kind: result.reason === "emailInUse" ? "emailInUse" : "invalid" } as const;
      }
      const user = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
      return { kind: "created", user } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", NO_SESSION);
        return;
      case "denied":
        sendError(res, 403, "ACCESO_DENEGADO", NOT_ALLOWED);
        return;
      case "invalid":
        sendError(res, 400, "ENTRADA_INVALIDA", INVALID);
        return;
      case "emailInUse":
        sendError(res, 409, "CORREO_EN_USO", "Ya existe una cuenta con ese correo.");
        return;
      case "created":
        res.status(201).json(toUsuario(outcome.user));
    }
  });

  // US-03, FR-04: deactivate or reactivate an operator account. Deactivating
  // revokes its sessions (NFR-04); nothing is deleted (BR-12).
  router.post("/:id/estado", async (req, res) => {
    const params = accountParams.safeParse(req.params);
    const body = stateBody.safeParse(req.body);
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const access = await authorizeAdministrator(db, req, now);
      if (access.kind !== "allowed") return access;
      if (!params.success || !body.success) return { kind: "invalid" } as const;
      const result = await setAccountActive(db, {
        userId: params.data.id,
        active: body.data.activa,
        now,
        changedBy: { userId: access.user.id, ip: req.ip ?? "" },
      });
      if (!result.ok) return { kind: result.reason } as const;
      const user = await db.user.findUniqueOrThrow({ where: { id: params.data.id } });
      return { kind: "changed", user } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", NO_SESSION);
        return;
      case "denied":
        sendError(res, 403, "ACCESO_DENEGADO", NOT_ALLOWED);
        return;
      case "invalid":
        sendError(res, 400, "ENTRADA_INVALIDA", INVALID);
        return;
      case "notFound":
        sendError(res, 404, "NO_ENCONTRADO", "La cuenta no existe.");
        return;
      case "notOperator":
        sendError(
          res,
          409,
          "CUENTA_NO_OPERADOR",
          "Solo las cuentas de operador se desactivan o reactivan.",
        );
        return;
      case "alreadyInState":
        sendError(res, 409, "CUENTA_YA_EN_ESE_ESTADO", "La cuenta ya estaba en ese estado.");
        return;
      case "changed":
        res.status(200).json(toUsuario(outcome.user));
    }
  });

  return router;
}

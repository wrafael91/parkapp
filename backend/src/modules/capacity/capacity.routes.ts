import { Router } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient, VehicleType } from "../../generated/prisma/client.js";
import { sendError } from "../../middleware/errors.js";
import { authorizeAdministrator } from "../accounts/authorize.js";
import { readSessionToken } from "../accounts/session-cookie.js";
import { authenticate } from "../accounts/session.service.js";
import { setCapacity } from "./capacity.js";

type Db = Prisma.TransactionClient;

// The @map values of schema.prisma (ADR 0008, decision 4), in the order the
// screen shows them.
const VEHICLE_TYPES = { CARRO: "CAR", MOTO: "MOTORCYCLE" } as const satisfies Record<
  string,
  VehicleType
>;

// ADR 0008: { tipoVehiculo, cupos }, with cupos null to remove the limit. Any
// number gets through the schema, so setCapacity decides RI-21.
const capacityBody = z.object({
  tipoVehiculo: z.enum(["CARRO", "MOTO"]),
  cupos: z.number().nullable(),
});

const NO_SESSION = "No hay una sesión activa.";
const NOT_ALLOWED = "No tienes permiso para esta acción.";
const INVALID = "Los datos enviados no son válidos.";

// BR-19: the spaces of a type (null if it has no limit), the vehicles of that type
// inside and the free spaces, which are never below 0 even if the spaces were set
// below the vehicles inside.
async function occupancy(db: Db, tipoVehiculo: keyof typeof VEHICLE_TYPES) {
  const vehicleType = VEHICLE_TYPES[tipoVehiculo];
  const capacity = await db.capacity.findFirst({ where: { vehicleType, validTo: null } });
  const ocupados = await db.stay.count({ where: { vehicleType, status: "ACTIVE" } });
  const cupos = capacity?.spaces ?? null;
  return {
    tipoVehiculo,
    cupos,
    ocupados,
    libres: cupos === null ? null : Math.max(0, cupos - ocupados),
  };
}

// The Origin check runs before these routes (app.ts). Each request runs in one
// transaction, and the response goes out after it commits, so a 403 is logged.
export function createCapacityRouter(prisma: PrismaClient): Router {
  const router = Router();

  // FR-24: the board of the Operation tab, for operators and administrators
  // (matrix 1.2), so it needs a session but no role.
  router.get("/", async (req, res) => {
    const token = readSessionToken(req.get("Cookie"));
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const user = token === null ? null : await authenticate(db, { token, now });
      if (user === null) return { kind: "unauthenticated" } as const;
      const cupos = [await occupancy(db, "CARRO"), await occupancy(db, "MOTO")];
      return { kind: "found", cupos } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", NO_SESSION);
        return;
      case "found":
        res.status(200).json({ cupos: outcome.cupos });
    }
  });

  // FR-24: sets the spaces of a type (a new version) or removes its limit (the
  // current version is closed). The vehicles inside stay (BR-19).
  router.post("/", async (req, res) => {
    const body = capacityBody.safeParse(req.body);
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const access = await authorizeAdministrator(db, req, now);
      if (access.kind !== "allowed") return access;
      if (!body.success) return { kind: "invalid" } as const;
      const result = await setCapacity(db, {
        vehicleType: VEHICLE_TYPES[body.data.tipoVehiculo],
        spaces: body.data.cupos,
        now,
        changedBy: { userId: access.user.id, ip: req.ip ?? "" },
      });
      if (!result.ok) return { kind: result.reason } as const;
      const cupos = await occupancy(db, body.data.tipoVehiculo);
      return { kind: body.data.cupos === null ? "removed" : "set", cupos } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", NO_SESSION);
        return;
      case "denied":
        sendError(res, 403, "ACCESO_DENEGADO", NOT_ALLOWED);
        return;
      case "invalid":
      case "invalidSpaces":
        sendError(res, 400, "ENTRADA_INVALIDA", INVALID);
        return;
      case "noCapacity":
        sendError(
          res,
          409,
          "SIN_CUPOS_CONFIGURADOS",
          "Ese tipo de vehículo no tiene cupos configurados.",
        );
        return;
      case "changedMeanwhile":
        sendError(
          res,
          409,
          "CUPOS_CAMBIARON",
          "Otro administrador cambió los cupos al mismo tiempo. Revisa los valores y vuelve a guardar.",
        );
        return;
      case "removed":
        res.status(200).json(outcome.cupos);
        return;
      case "set":
        res.status(201).json(outcome.cupos);
    }
  });

  return router;
}

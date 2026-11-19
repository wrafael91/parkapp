import { Router } from "express";
import type { Prisma, PrismaClient, VehicleType } from "../../generated/prisma/client.js";
import { sendError } from "../../middleware/errors.js";
import { readSessionToken } from "../accounts/session-cookie.js";
import { authenticate } from "../accounts/session.service.js";

type Db = Prisma.TransactionClient;

// The @map values of schema.prisma (ADR 0008, decision 4), in the order the
// screen shows them.
const VEHICLE_TYPES = { CARRO: "CAR", MOTO: "MOTORCYCLE" } as const satisfies Record<
  string,
  VehicleType
>;

const NO_SESSION = "No hay una sesión activa.";

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

  return router;
}

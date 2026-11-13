import { Router, type Request } from "express";
import type {
  LegalCap,
  Prisma,
  PrismaClient,
  Rate,
  VehicleType,
} from "../../generated/prisma/client.js";
import { sendError } from "../../middleware/errors.js";
import { readSessionToken } from "../accounts/session-cookie.js";
import { authenticate, type SessionUser } from "../accounts/session.service.js";

type Db = Prisma.TransactionClient;

// The @map values of schema.prisma (ADR 0008, decision 4), in the order the
// screen shows them.
const VEHICLE_TYPES = { CARRO: "CAR", MOTO: "MOTORCYCLE" } as const satisfies Record<
  string,
  VehicleType
>;
const VEHICLE_TYPE_NAMES = { CAR: "CARRO", MOTORCYCLE: "MOTO" } as const satisfies Record<
  VehicleType,
  string
>;

// Without a session, 401 before anything else (NFR-04).
async function signedInUser(db: Db, req: Request, now: Date): Promise<SessionUser | null> {
  const token = readSessionToken(req.get("Cookie"));
  return token === null ? null : await authenticate(db, { token, now });
}

function current(now: Date) {
  return { validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] };
}

// ADR 0008: a rate in Spanish, with the legal cap the screen shows (FR-16).
function toTarifa(rate: Rate, legalCap: LegalCap) {
  return {
    tipoVehiculo: VEHICLE_TYPE_NAMES[rate.vehicleType],
    valorMinuto: rate.valuePerMinute,
    topeLegal: legalCap.valuePerMinute,
    vigenteDesde: rate.validFrom.toISOString(),
  };
}

const NO_SESSION = "No hay una sesión activa.";

// The Origin check runs before these routes (app.ts). Each request runs in one
// transaction, and the response goes out after it commits.
export function createRatesRouter(prisma: PrismaClient): Router {
  const router = Router();

  // FR-16: the current rate of each vehicle type, with its current legal cap.
  router.get("/", async (req, res) => {
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const user = await signedInUser(db, req, now);
      if (user === null) return { kind: "unauthenticated" } as const;
      const tarifas = [];
      for (const vehicleType of Object.values(VEHICLE_TYPES)) {
        const legalCap = await db.legalCap.findFirst({ where: { vehicleType, ...current(now) } });
        const rate = await db.rate.findFirst({ where: { vehicleType, ...current(now) } });
        if (legalCap !== null && rate !== null) tarifas.push(toTarifa(rate, legalCap));
      }
      return { kind: "listed", tarifas } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", NO_SESSION);
        return;
      case "listed":
        res.status(200).json({ tarifas: outcome.tarifas });
    }
  });

  return router;
}

// ADR 0008: the grace period exists once, so its route is singular.
export function createGracePeriodRouter(prisma: PrismaClient): Router {
  const router = Router();

  // FR-17: the current grace period, or null minutes if none was loaded.
  router.get("/", async (req, res) => {
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const user = await signedInUser(db, req, now);
      if (user === null) return { kind: "unauthenticated" } as const;
      const gracePeriod = await db.gracePeriod.findFirst({ where: current(now) });
      return { kind: "found", gracePeriod } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", NO_SESSION);
        return;
      case "found":
        res.status(200).json({
          minutos: outcome.gracePeriod?.minutes ?? null,
          vigenteDesde: outcome.gracePeriod?.validFrom.toISOString() ?? null,
        });
    }
  });

  return router;
}

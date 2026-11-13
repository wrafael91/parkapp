import { Router, type Request } from "express";
import { z } from "zod";
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
import { setGracePeriod, setRate } from "./rate-settings.js";

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

// ADR 0008: the contract is in Spanish. Any number gets through the schema, so
// the rules of setRate and setGracePeriod decide (RI-09, RI-10).
const rateBody = z.object({
  tipoVehiculo: z.enum(["CARRO", "MOTO"]),
  valorMinuto: z.number(),
});
const gracePeriodBody = z.object({ minutos: z.number() });

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
const INVALID = "Los datos enviados no son válidos.";

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

  // FR-16: a new rate version, valid from now; the previous one is kept (BR-11).
  router.post("/", async (req, res) => {
    const body = rateBody.safeParse(req.body);
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const user = await signedInUser(db, req, now);
      if (user === null) return { kind: "unauthenticated" } as const;
      if (!body.success) return { kind: "invalid" } as const;
      const result = await setRate(db, {
        vehicleType: VEHICLE_TYPES[body.data.tipoVehiculo],
        valuePerMinute: body.data.valorMinuto,
        createdById: user.id,
        now,
        changedBy: { userId: user.id, ip: req.ip ?? "" },
      });
      if (!result.ok) {
        if (result.reason === "invalidValue") return { kind: "invalid" } as const;
        if (result.reason === "aboveLegalCap") {
          return { kind: "aboveLegalCap", legalCap: result.legalCap } as const;
        }
        return { kind: "noLegalCap" } as const;
      }
      const rate = await db.rate.findUniqueOrThrow({
        where: { id: result.rateId },
        include: { legalCap: true },
      });
      return { kind: "created", tarifa: toTarifa(rate, rate.legalCap) } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", NO_SESSION);
        return;
      case "invalid":
        sendError(res, 400, "ENTRADA_INVALIDA", INVALID);
        return;
      // BR-10: nothing changes, and the message names the current cap.
      case "aboveLegalCap":
        sendError(
          res,
          400,
          "TARIFA_SUPERA_TOPE",
          `La tarifa supera el tope legal vigente ($${outcome.legalCap} por minuto).`,
        );
        return;
      // Only if the legal caps migration were missing (BR-15).
      case "noLegalCap":
        sendError(res, 409, "SIN_TOPE_LEGAL", "No hay un tope legal vigente para ese vehículo.");
        return;
      case "created":
        res.status(201).json(outcome.tarifa);
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

  // FR-17: a new version that applies only to later entries (BR-11).
  router.post("/", async (req, res) => {
    const body = gracePeriodBody.safeParse(req.body);
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const user = await signedInUser(db, req, now);
      if (user === null) return { kind: "unauthenticated" } as const;
      if (!body.success) return { kind: "invalid" } as const;
      const result = await setGracePeriod(db, {
        minutes: body.data.minutos,
        createdById: user.id,
        now,
        changedBy: { userId: user.id, ip: req.ip ?? "" },
      });
      if (!result.ok) return { kind: "invalid" } as const;
      const gracePeriod = await db.gracePeriod.findUniqueOrThrow({
        where: { id: result.gracePeriodId },
      });
      return { kind: "created", gracePeriod } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", NO_SESSION);
        return;
      case "invalid":
        sendError(res, 400, "ENTRADA_INVALIDA", INVALID);
        return;
      case "created":
        res.status(201).json({
          minutos: outcome.gracePeriod.minutes,
          vigenteDesde: outcome.gracePeriod.validFrom.toISOString(),
        });
    }
  });

  return router;
}

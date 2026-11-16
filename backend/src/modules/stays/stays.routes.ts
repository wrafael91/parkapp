import { Router } from "express";
import { z } from "zod";
import type {
  PeriodCap,
  PrismaClient,
  Rate,
  Receipt,
  Stay,
  StayStatus,
  VehicleType,
} from "../../generated/prisma/client.js";
import { sendError } from "../../middleware/errors.js";
import { readSessionToken } from "../accounts/session-cookie.js";
import { authenticate } from "../accounts/session.service.js";
import { registerEntry } from "./entry.service.js";
import { registerExit } from "./exit.service.js";

// The @map values of schema.prisma (ADR 0008, decision 4).
const VEHICLE_TYPES = { CARRO: "CAR", MOTO: "MOTORCYCLE" } as const satisfies Record<
  string,
  VehicleType
>;
const VEHICLE_TYPE_NAMES = { CAR: "CARRO", MOTORCYCLE: "MOTO" } as const satisfies Record<
  VehicleType,
  string
>;
const STAY_STATUS_NAMES = {
  ACTIVE: "ACTIVA",
  CLOSED: "CERRADA",
  VOIDED: "ANULADA",
} as const satisfies Record<StayStatus, string>;

// ADR 0008: the contract is in Spanish, and this module translates it. Unknown
// fields are dropped, horaIngreso included: the server sets the time (BR-16).
const entryBody = z.object({
  placa: z.string().min(1).max(20),
  tipoVehiculo: z.enum(["CARRO", "MOTO"]),
  color: z.string().trim().min(1).max(30),
  marca: z.string().trim().max(40).nullish(),
});

// The vehicles inside (FR-10): estado=ACTIVA and nothing else.
const activeQuery = z.strictObject({ estado: z.literal("ACTIVA") });

// A calendar day that exists: 2026-02-30 is not one. Zod 4 runs the refine even
// when the regex failed, so an invalid date must not reach toISOString, which
// would throw a RangeError and answer 500.
const calendarDay = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  .refine((day) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day);
  });

// FR-08 without the format check, so part of a plate can be searched (FR-11):
// uppercase, without spaces or hyphens, and then 1 to 6 letters or digits.
const plateSearch = z
  .string()
  .transform((plate) => plate.toUpperCase().replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^[A-Z0-9]{1,6}$/));

// The history (FR-18, US-13): a day, part of a plate or both, and the vehicle
// type. Without a day or a plate it would bring back every stay, so it is a 400.
const historyQuery = z
  .strictObject({
    fecha: calendarDay.optional(),
    placa: plateSearch.optional(),
    tipoVehiculo: z.enum(["CARRO", "MOTO"]).optional(),
  })
  .refine((query) => query.fecha !== undefined || query.placa !== undefined);

// Mixing estado with the history filters matches neither, so it is a 400.
const listQuery = z.union([activeQuery, historyQuery]);

// ADR 0008, update of November 15: Colombia is on UTC-5 all year, so a day in
// Bogotá runs from 05:00 UTC to 05:00 UTC the next day. The range is compared
// with the UTC columns, without depending on the time zone of the session.
function bogotaDay(day: string) {
  const start = new Date(`${day}T00:00:00.000-05:00`);
  return { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

// A stay id: a positive integer, without leading zeros, that fits in the
// INTEGER column. Anything else is a 400, not a database error.
const exitParams = z.object({
  id: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number)
    .refine((id) => id <= 2_147_483_647),
});

// ADR 0008: a stay in Spanish, as the entry and the list answer it.
function toEstadia(stay: Stay) {
  return {
    id: stay.id,
    placa: stay.plate,
    tipoVehiculo: VEHICLE_TYPE_NAMES[stay.vehicleType],
    color: stay.color,
    marca: stay.brand,
    horaIngreso: stay.entryTime.toISOString(),
  };
}

// A stay of the history: every state, with its exit and its receipt, if any.
function toHistorial(stay: Stay & { receipt: Receipt | null }) {
  return {
    ...toEstadia(stay),
    horaSalida: stay.exitTime?.toISOString() ?? null,
    estado: STAY_STATUS_NAMES[stay.status],
    comprobante:
      stay.receipt === null
        ? null
        : { consecutivo: stay.receipt.number, total: stay.receipt.total },
  };
}

// ADR 0008: the receipt with the fields of BR-14. The rate per minute and the cap
// come from the stay, since the receipt keeps only the results (data model,
// decision 5). The cap is null if none was in force at entry (BR-11).
function toComprobante(
  receipt: Receipt & { stay: Stay & { rate: Rate; periodCap: PeriodCap | null } },
) {
  const { stay } = receipt;
  return {
    consecutivo: receipt.number,
    estadiaId: stay.id,
    placa: stay.plate,
    tipoVehiculo: VEHICLE_TYPE_NAMES[stay.vehicleType],
    horaIngreso: stay.entryTime.toISOString(),
    horaSalida: stay.exitTime?.toISOString(),
    minutosCompletos: receipt.fullMinutes,
    valorMinuto: stay.rate.valuePerMinute,
    topePeriodo:
      stay.periodCap === null ? null : { horas: stay.periodCap.hours, valor: stay.periodCap.value },
    subtotal: receipt.subtotal,
    descuentoTope: receipt.capDiscount,
    ajusteRedondeo: receipt.roundingAdjustment,
    total: receipt.total,
  };
}

// The Origin check runs before these routes (app.ts). Each request runs in one
// transaction, decided here, and the response goes out after it commits.
export function createStaysRouter(prisma: PrismaClient): Router {
  const router = Router();

  // FR-07: registers an entry for a signed-in operator or administrator.
  router.post("/", async (req, res) => {
    const token = readSessionToken(req.get("Cookie"));
    const body = entryBody.safeParse(req.body);
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const user = token === null ? null : await authenticate(db, { token, now });
      if (user === null) return { kind: "unauthenticated" } as const;
      if (!body.success) return { kind: "invalid" } as const;
      const result = await registerEntry(db, {
        plate: body.data.placa,
        vehicleType: VEHICLE_TYPES[body.data.tipoVehiculo],
        color: body.data.color,
        brand: body.data.marca ?? undefined,
        userId: user.id,
        ip: req.ip ?? "",
        now,
      });
      if (!result.ok) return { kind: result.reason } as const;
      const stay = await db.stay.findUniqueOrThrow({ where: { id: result.stayId } });
      return { kind: "registered", stay } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", "No hay una sesión activa.");
        return;
      case "invalid":
      case "invalidPlate":
        sendError(res, 400, "ENTRADA_INVALIDA", "Los datos enviados no son válidos.");
        return;
      // BR-03 and FR-09: the rejection was committed with its audit event.
      case "plateActive":
        sendError(
          res,
          409,
          "PLACA_ACTIVA",
          "La placa ya tiene una estadía activa: posible placa clonada.",
        );
        return;
      case "registered":
        res.status(201).json(toEstadia(outcome.stay));
    }
  });

  // FR-10: the vehicles inside, newest first. FR-18: the history, for operators
  // and administrators (requirements, section 1.3, decision 5).
  router.get("/", async (req, res) => {
    const token = readSessionToken(req.get("Cookie"));
    const query = listQuery.safeParse(req.query);
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const user = token === null ? null : await authenticate(db, { token, now });
      if (user === null) return { kind: "unauthenticated" } as const;
      if (!query.success) return { kind: "invalid" } as const;
      if ("estado" in query.data) {
        const stays = await db.stay.findMany({
          where: { status: "ACTIVE" },
          orderBy: [{ entryTime: "desc" }, { id: "desc" }],
        });
        return { kind: "listed", stays } as const;
      }
      const { fecha, placa, tipoVehiculo } = query.data;
      const stays = await db.stay.findMany({
        where: {
          entryTime: fecha === undefined ? undefined : bogotaDay(fecha),
          plate: placa === undefined ? undefined : { contains: placa },
          vehicleType: tipoVehiculo === undefined ? undefined : VEHICLE_TYPES[tipoVehiculo],
        },
        orderBy: [{ entryTime: "desc" }, { id: "desc" }],
        include: { receipt: true },
      });
      return { kind: "history", stays } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", "No hay una sesión activa.");
        return;
      case "invalid":
        sendError(res, 400, "ENTRADA_INVALIDA", "Los datos enviados no son válidos.");
        return;
      case "listed":
        res.status(200).json({ estadias: outcome.stays.map(toEstadia) });
        return;
      case "history":
        res.status(200).json({ estadias: outcome.stays.map(toHistorial) });
    }
  });

  // FR-12 to FR-14: registers the exit of a stay and issues its receipt. The
  // body is ignored: the server sets the exit time (BR-16). A RangeError from
  // calculateFee rolls the transaction back and reaches the error handler,
  // which answers ERROR_INTERNO without details (NFR-07).
  router.post("/:id/salida", async (req, res) => {
    const token = readSessionToken(req.get("Cookie"));
    const params = exitParams.safeParse(req.params);
    const now = new Date();
    const outcome = await prisma.$transaction(async (db) => {
      const user = token === null ? null : await authenticate(db, { token, now });
      if (user === null) return { kind: "unauthenticated" } as const;
      if (!params.success) return { kind: "invalid" } as const;
      const result = await registerExit(db, {
        stayId: params.data.id,
        userId: user.id,
        ip: req.ip ?? "",
        now,
      });
      if (!result.ok) return { kind: result.reason } as const;
      const receipt = await db.receipt.findUniqueOrThrow({
        where: { id: result.receiptId },
        include: { stay: { include: { rate: true, periodCap: true } } },
      });
      return { kind: "registered", receipt } as const;
    });

    switch (outcome.kind) {
      case "unauthenticated":
        sendError(res, 401, "NO_AUTENTICADO", "No hay una sesión activa.");
        return;
      case "invalid":
        sendError(res, 400, "ENTRADA_INVALIDA", "Los datos enviados no son válidos.");
        return;
      case "notFound":
        sendError(res, 404, "NO_ENCONTRADO", "La estadía no existe.");
        return;
      case "notActive":
        sendError(
          res,
          409,
          "ESTADIA_NO_ACTIVA",
          "La estadía ya no está activa: puede que ya se haya registrado su salida.",
        );
        return;
      case "registered":
        res.status(201).json(toComprobante(outcome.receipt));
    }
  });

  return router;
}

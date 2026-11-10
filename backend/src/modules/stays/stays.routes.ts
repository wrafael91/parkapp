import { Router } from "express";
import { z } from "zod";
import type { PrismaClient, VehicleType } from "../../generated/prisma/client.js";
import { sendError } from "../../middleware/errors.js";
import { readSessionToken } from "../accounts/session-cookie.js";
import { authenticate } from "../accounts/session.service.js";
import { registerEntry } from "./entry.service.js";

// The @map values of schema.prisma (ADR 0008, decision 4).
const VEHICLE_TYPES = { CARRO: "CAR", MOTO: "MOTORCYCLE" } as const satisfies Record<
  string,
  VehicleType
>;
const VEHICLE_TYPE_NAMES = { CAR: "CARRO", MOTORCYCLE: "MOTO" } as const satisfies Record<
  VehicleType,
  string
>;

// ADR 0008: the contract is in Spanish, and this module translates it. Unknown
// fields are dropped, horaIngreso included: the server sets the time (BR-16).
const entryBody = z.object({
  placa: z.string().min(1).max(20),
  tipoVehiculo: z.enum(["CARRO", "MOTO"]),
  color: z.string().trim().min(1).max(30),
  marca: z.string().trim().max(40).nullish(),
});

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
      case "plateActive":
        sendError(res, 400, "ENTRADA_INVALIDA", "Los datos enviados no son válidos.");
        return;
      case "registered": {
        const { stay } = outcome;
        res.status(201).json({
          id: stay.id,
          placa: stay.plate,
          tipoVehiculo: VEHICLE_TYPE_NAMES[stay.vehicleType],
          color: stay.color,
          marca: stay.brand,
          horaIngreso: stay.entryTime.toISOString(),
        });
      }
    }
  });

  return router;
}

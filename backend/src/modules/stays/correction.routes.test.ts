// Tests of POST /api/estadias/{id}/correccion (stays.routes.ts). They live apart
// from stays.routes.test.ts so each file stays readable.
import type { Express } from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient, Role } from "../../generated/prisma/client.js";
import { closeCurrentVersions } from "../../versions.test-helper.js";
import { hashSessionToken } from "../accounts/session-token.js";
import { setGracePeriod, setRate } from "../rates/rate-settings.js";
import { registerEntry } from "./entry.service.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const IP = "198.51.100.47";
const TOKEN = "token-de-prueba-de-la-ruta-de-correccion-01";

// Like the other route tests, each test runs as parkapp_app and always rolls
// back. The route's transaction is a savepoint inside the test transaction.
async function withApp(test: (app: Express, db: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
        await closeCurrentVersions(tx);
        const prismaInTest = {
          $transaction: async (run: (db: Prisma.TransactionClient) => Promise<unknown>) => {
            await tx.$executeRawUnsafe("SAVEPOINT route");
            try {
              const result = await run(tx);
              await tx.$executeRawUnsafe("RELEASE SAVEPOINT route");
              return result;
            } catch (error) {
              await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT route");
              throw error;
            }
          },
        } as unknown as PrismaClient;
        await test(createApp(prismaInTest, { allowedOrigin: ORIGIN }), tx);
        throw new Rollback();
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

const ENTRY = minutesFromNow(-30);

// A user with an active session of the given role, an operator who registered a
// car with the COR128 plate half an hour ago, and the production rates ($230 and,
// unless left out, $161) and grace period. The COR plates are only for these tests.
async function setUp(
  db: Prisma.TransactionClient,
  role: Role,
  options: { motorcycleRate?: boolean } = {},
) {
  const user = await db.user.create({
    data: {
      name: "Usuario de la corrección",
      email: "usuario.correccion@example.com",
      passwordHash: "not-a-real-hash",
      role,
      mustChangePassword: false,
    },
  });
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(TOKEN),
      ip: IP,
      expiresAt: minutesFromNow(60),
    },
  });
  const operator = await db.user.create({
    data: {
      name: "Operador del ingreso",
      email: "operador.ingreso.correccion@example.com",
      passwordHash: "not-a-real-hash",
      role: "OPERATOR",
      mustChangePassword: false,
    },
  });
  const ratesFrom = minutesFromNow(-60);
  const car = await setRate(db, {
    vehicleType: "CAR",
    valuePerMinute: 230,
    createdById: user.id,
    now: ratesFrom,
  });
  const grace = await setGracePeriod(db, { minutes: 5, createdById: user.id, now: ratesFrom });
  if (!car.ok || !grace.ok) throw new Error("setup failed");
  if (options.motorcycleRate !== false) {
    const motorcycle = await setRate(db, {
      vehicleType: "MOTORCYCLE",
      valuePerMinute: 161,
      createdById: user.id,
      now: ratesFrom,
    });
    if (!motorcycle.ok) throw new Error("setup failed");
  }
  const entry = await registerEntry(db, {
    plate: "COR128",
    vehicleType: "CAR",
    color: "Azul",
    userId: operator.id,
    ip: IP,
    now: ENTRY,
  });
  if (!entry.ok) throw new Error("setup failed");
  return { user, operator, stayId: entry.stayId, cookie: `sesion=${TOKEN}` };
}

const VALID = {
  placa: "COR123",
  tipoVehiculo: "CARRO",
  color: "Azul",
  motivo: "Placa mal digitada",
};

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function postCorrection(app: Express, id: number | string, cookie?: string, body: object = VALID) {
  const req = request(app)
    .post(`/api/estadias/${id}/correccion`)
    .set("Origin", ORIGIN)
    .set("X-Forwarded-For", IP);
  return (cookie === undefined ? req : req.set("Cookie", cookie)).send(body);
}

async function unchanged(db: Prisma.TransactionClient, stayId: number) {
  const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
  expect(stay.status).toBe("ACTIVE");
  expect(await db.stay.count({ where: { replacesId: stayId } })).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "STAY_CORRECTED", ip: IP } })).toBe(0);
}

describe("POST /api/estadias/{id}/correccion (FR-21, BR-17, ADR 0008)", () => {
  it("corrects the stay and answers 201 with the replacement in Spanish", async () => {
    await withApp(async (app, db) => {
      const { user, stayId, cookie } = await setUp(db, "ADMINISTRATOR");

      const response = await postCorrection(app, stayId, cookie, {
        ...VALID,
        placa: "cor-123",
        marca: "Kia",
        motivo: "  Placa mal digitada  ",
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(Number),
        placa: "COR123",
        tipoVehiculo: "CARRO",
        color: "Azul",
        marca: "Kia",
        horaIngreso: ENTRY.toISOString(),
        reemplazaA: stayId,
      });
      const voided = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(voided).toMatchObject({
        status: "VOIDED",
        voidedById: user.id,
        voidReason: "Placa mal digitada",
      });
      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "STAY_CORRECTED", ip: IP },
      });
      expect(event).toMatchObject({ userId: user.id, entityId: response.body.id });
    });
  });

  it("corrects the vehicle type", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await setUp(db, "ADMINISTRATOR");

      const response = await postCorrection(app, stayId, cookie, {
        ...VALID,
        placa: "COR12A",
        tipoVehiculo: "MOTO",
        marca: null,
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ placa: "COR12A", tipoVehiculo: "MOTO", marca: null });
    });
  });

  it("answers 400 ENTRADA_INVALIDA to an invalid id or body, and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await setUp(db, "ADMINISTRATOR");
      const ids = ["0", "abc", "01", "2147483648"];
      const bodies = [
        { ...VALID, motivo: undefined },
        { ...VALID, motivo: "   " },
        { ...VALID, motivo: "x".repeat(201) },
        { ...VALID, horaIngreso: "2026-11-09T08:02:00.000Z" },
        { ...VALID, placa: "COR12A" },
        { ...VALID, tipoVehiculo: "BUS" },
        { ...VALID, color: "" },
      ];

      // One at a time: each request opens its own savepoint in the test transaction.
      const responses = [];
      for (const id of ids) responses.push(await postCorrection(app, id, cookie));
      for (const body of bodies) responses.push(await postCorrection(app, stayId, cookie, body));

      for (const response of responses) {
        expect(response.status).toBe(400);
        expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      }
      await unchanged(db, stayId);
    });
  });

  it("answers 400 SIN_CAMBIOS when nothing changes", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await setUp(db, "ADMINISTRATOR");

      const response = await postCorrection(app, stayId, cookie, { ...VALID, placa: "COR128" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: { codigo: "SIN_CAMBIOS", mensaje: "La corrección no cambia ningún dato." },
      });
      await unchanged(db, stayId);
    });
  });

  it("answers 404 NO_ENCONTRADO for a stay that does not exist", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await setUp(db, "ADMINISTRATOR");

      const response = await postCorrection(app, 2_147_483_647, cookie);

      expect(response.status).toBe(404);
      expect(response.body.error.codigo).toBe("NO_ENCONTRADO");
    });
  });

  it("answers 409 ESTADIA_NO_ACTIVA for a stay that already left or was corrected", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await setUp(db, "ADMINISTRATOR");

      const first = await postCorrection(app, stayId, cookie);
      const second = await postCorrection(app, stayId, cookie, { ...VALID, placa: "COR124" });

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(second.body).toEqual({
        error: {
          codigo: "ESTADIA_NO_ACTIVA",
          mensaje:
            "La estadía ya no está activa: puede que ya se haya registrado su salida o que ya se haya corregido.",
        },
      });
      expect(await db.stay.count({ where: { replacesId: stayId } })).toBe(1);
    });
  });

  it("answers 409 PLACA_ACTIVA when the corrected plate is inside, and changes nothing (RI-02)", async () => {
    await withApp(async (app, db) => {
      const { operator, stayId, cookie } = await setUp(db, "ADMINISTRATOR");
      const other = await registerEntry(db, {
        plate: "COR123",
        vehicleType: "CAR",
        color: "Gris",
        userId: operator.id,
        ip: IP,
        now: ENTRY,
      });
      if (!other.ok) throw new Error("setup failed");

      const response = await postCorrection(app, stayId, cookie);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          codigo: "PLACA_ACTIVA",
          mensaje: "La placa corregida ya tiene una estadía activa.",
        },
      });
      await unchanged(db, stayId);
    });
  });

  it("answers 409 SIN_TARIFA when the new type had no rate at the entry, and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await setUp(db, "ADMINISTRATOR", { motorcycleRate: false });

      const response = await postCorrection(app, stayId, cookie, {
        ...VALID,
        placa: "COR12A",
        tipoVehiculo: "MOTO",
      });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          codigo: "SIN_TARIFA",
          mensaje: "No había tarifa para ese tipo de vehículo a la hora del ingreso.",
        },
      });
      await unchanged(db, stayId);
    });
  });

  it("answers 401 without a session, before validating", async () => {
    await withApp(async (app, db) => {
      const { stayId } = await setUp(db, "ADMINISTRATOR");

      const valid = await postCorrection(app, stayId);
      const invalid = await postCorrection(app, "abc", undefined, {});

      expect(valid.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(valid.body.error.codigo).toBe("NO_AUTENTICADO");
      await unchanged(db, stayId);
    });
  });

  it("answers an operator 403, before validating, logs ACCESO_DENEGADO and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { user, stayId, cookie } = await setUp(db, "OPERATOR");

      const valid = await postCorrection(app, stayId, cookie);
      const invalid = await postCorrection(app, "abc", cookie, {});

      expect(valid.status).toBe(403);
      expect(valid.body).toEqual({
        error: { codigo: "ACCESO_DENEGADO", mensaje: "No tienes permiso para esta acción." },
      });
      expect(invalid.status).toBe(403);
      const events = await db.auditEvent.findMany({
        where: { action: "ACCESS_DENIED", userId: user.id },
      });
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        detail: { metodo: "POST", ruta: `/api/estadias/${stayId}/correccion` },
        ip: IP,
      });
      await unchanged(db, stayId);
    });
  });

  // Passes from the start, on purpose: the Origin check of app.ts runs before
  // every route (docs/modelo-amenazas.md, 7.4).
  it("a correction without Origin answers 403 ORIGEN_NO_PERMITIDO and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await setUp(db, "ADMINISTRATOR");

      const response = await request(app)
        .post(`/api/estadias/${stayId}/correccion`)
        .set("Cookie", cookie)
        .send(VALID);

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      await unchanged(db, stayId);
    });
  });
});

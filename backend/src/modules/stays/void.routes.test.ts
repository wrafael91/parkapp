// Tests of POST /api/estadias/{id}/anulacion (stays.routes.ts). They live apart
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
import { registerExit } from "./exit.service.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const IP = "198.51.100.58";
const TOKEN = "token-de-prueba-de-la-ruta-de-anulacion-001";

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
const EXIT = minutesFromNow(-10);

// A user with an active session of the given role, an operator who registered a
// car with the ANU128 plate half an hour ago, and the production rates and grace
// period. The ANU plates are only for these tests.
async function setUp(db: Prisma.TransactionClient, role: Role) {
  const user = await db.user.create({
    data: {
      name: "Usuario de la anulación",
      email: "usuario.anulacion@example.com",
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
      email: "operador.ingreso.anulacion@example.com",
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
  const entry = await registerEntry(db, {
    plate: "ANU128",
    vehicleType: "CAR",
    color: "Azul",
    userId: operator.id,
    ip: IP,
    now: ENTRY,
  });
  if (!entry.ok) throw new Error("setup failed");
  return { user, operator, stayId: entry.stayId, cookie: `sesion=${TOKEN}` };
}

// The reason, and the state History showed the administrator.
const VALID = { motivo: "El vehículo no entró", estado: "ACTIVA" };

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function postVoid(app: Express, id: number | string, cookie?: string, body: object = VALID) {
  const req = request(app)
    .post(`/api/estadias/${id}/anulacion`)
    .set("Origin", ORIGIN)
    .set("X-Forwarded-For", IP);
  return (cookie === undefined ? req : req.set("Cookie", cookie)).send(body);
}

async function unchanged(db: Prisma.TransactionClient, stayId: number) {
  const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
  expect(stay.status).toBe("ACTIVE");
  expect(stay.voidedAt).toBeNull();
  expect(await db.auditEvent.count({ where: { action: "STAY_VOIDED", ip: IP } })).toBe(0);
}

describe("POST /api/estadias/{id}/anulacion (FR-15, BR-12, ADR 0008)", () => {
  it("voids an active stay and answers 200 with the stay as History shows it", async () => {
    await withApp(async (app, db) => {
      const { user, stayId, cookie } = await setUp(db, "ADMINISTRATOR");

      const response = await postVoid(app, stayId, cookie, {
        ...VALID,
        motivo: "  El vehículo no entró  ",
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: stayId,
        placa: "ANU128",
        tipoVehiculo: "CARRO",
        color: "Azul",
        marca: null,
        horaIngreso: ENTRY.toISOString(),
        horaSalida: null,
        estado: "ANULADA",
        comprobante: null,
      });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay).toMatchObject({
        status: "VOIDED",
        voidedById: user.id,
        voidReason: "El vehículo no entró",
      });
      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "STAY_VOIDED", ip: IP },
      });
      expect(event).toMatchObject({ userId: user.id, entityId: stayId, detail: null });
    });
  });

  it("voids a closed stay and answers it with its exit and its receipt", async () => {
    await withApp(async (app, db) => {
      const { operator, stayId, cookie } = await setUp(db, "ADMINISTRATOR");
      const exit = await registerExit(db, { stayId, userId: operator.id, ip: IP, now: EXIT });
      if (!exit.ok) throw new Error("setup failed");
      const receipt = await db.receipt.findUniqueOrThrow({ where: { stayId } });

      const response = await postVoid(app, stayId, cookie, { ...VALID, estado: "CERRADA" });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: stayId,
        horaSalida: EXIT.toISOString(),
        estado: "ANULADA",
        comprobante: { consecutivo: receipt.number, total: receipt.total },
      });
    });
  });

  it("answers 400 ENTRADA_INVALIDA to an invalid id or body, and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await setUp(db, "ADMINISTRATOR");
      const ids = ["0", "abc", "01", "2147483648"];
      const bodies = [
        {},
        { estado: "ACTIVA" },
        { ...VALID, motivo: "   " },
        { ...VALID, motivo: "x".repeat(201) },
        { ...VALID, motivo: 12 },
        { motivo: "El vehículo no entró" },
        { ...VALID, estado: "ANULADA" },
        { ...VALID, horaSalida: "2026-11-09T08:30:00.000Z" },
      ];

      // One at a time: each request opens its own savepoint in the test transaction.
      const responses = [];
      for (const id of ids) responses.push(await postVoid(app, id, cookie));
      for (const body of bodies) responses.push(await postVoid(app, stayId, cookie, body));

      for (const response of responses) {
        expect(response.status).toBe(400);
        expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      }
      await unchanged(db, stayId);
    });
  });

  it("accepts a reason of 200 characters", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await setUp(db, "ADMINISTRATOR");

      const response = await postVoid(app, stayId, cookie, { ...VALID, motivo: "x".repeat(200) });

      expect(response.status).toBe(200);
    });
  });

  it("answers 404 NO_ENCONTRADO for a stay that does not exist", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await setUp(db, "ADMINISTRATOR");

      const response = await postVoid(app, 2_147_483_647, cookie);

      expect(response.status).toBe(404);
      expect(response.body.error.codigo).toBe("NO_ENCONTRADO");
    });
  });

  it("answers 409 ESTADIA_YA_ANULADA for a stay already voided", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await setUp(db, "ADMINISTRATOR");

      const first = await postVoid(app, stayId, cookie);
      const second = await postVoid(app, stayId, cookie, { ...VALID, motivo: "Otra vez" });

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(second.body).toEqual({
        error: { codigo: "ESTADIA_YA_ANULADA", mensaje: "La estadía ya estaba anulada." },
      });
      expect(await db.auditEvent.count({ where: { action: "STAY_VOIDED", ip: IP } })).toBe(1);
    });
  });

  // Case 27: History showed the stay inside, and the operator registered its
  // exit before the administrator confirmed.
  it("answers 409 ESTADIA_CAMBIADA when the stay is not as History showed it, and voids nothing", async () => {
    await withApp(async (app, db) => {
      const { operator, stayId, cookie } = await setUp(db, "ADMINISTRATOR");
      const exit = await registerExit(db, { stayId, userId: operator.id, ip: IP, now: EXIT });
      if (!exit.ok) throw new Error("setup failed");

      const response = await postVoid(app, stayId, cookie);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          codigo: "ESTADIA_CAMBIADA",
          mensaje:
            "La estadía cambió mientras tanto: puede que se haya registrado su salida o que se haya corregido. Revísala y vuelve a intentarlo.",
        },
      });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay).toMatchObject({ status: "CLOSED", voidedAt: null });
      expect(await db.auditEvent.count({ where: { action: "STAY_VOIDED", ip: IP } })).toBe(0);
    });
  });

  it("answers 401 without a session, before validating", async () => {
    await withApp(async (app, db) => {
      const { stayId } = await setUp(db, "ADMINISTRATOR");

      const valid = await postVoid(app, stayId);
      const invalid = await postVoid(app, "abc", undefined, {});

      expect(valid.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(valid.body.error.codigo).toBe("NO_AUTENTICADO");
      await unchanged(db, stayId);
    });
  });

  it("answers an operator 403, before validating, logs ACCESO_DENEGADO and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { user, stayId, cookie } = await setUp(db, "OPERATOR");

      const valid = await postVoid(app, stayId, cookie);
      const invalid = await postVoid(app, "abc", cookie, {});

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
        detail: { metodo: "POST", ruta: `/api/estadias/${stayId}/anulacion` },
        ip: IP,
      });
      await unchanged(db, stayId);
    });
  });

  // Passes from the start, on purpose: the Origin check of app.ts runs before
  // every route (docs/modelo-amenazas.md, 7.4).
  it("a void without Origin answers 403 ORIGEN_NO_PERMITIDO and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await setUp(db, "ADMINISTRATOR");

      const response = await request(app)
        .post(`/api/estadias/${stayId}/anulacion`)
        .set("Cookie", cookie)
        .send(VALID);

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      await unchanged(db, stayId);
    });
  });
});

// Tests of POST /api/estadias/{id}/salida (stays.routes.ts). They live apart
// from stays.routes.test.ts so each file stays readable.
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { hashSessionToken } from "../accounts/session-token.js";
import { setGracePeriod, setRate } from "../rates/rate-settings.js";
import { registerEntry } from "./entry.service.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => {
  vi.restoreAllMocks();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const IP = "198.51.100.42";
const TOKEN = "token-de-prueba-de-la-ruta-de-salida-000001";

// Like the other route tests, each test runs as parkapp_app and always rolls
// back. The route's transaction is a savepoint inside the test transaction, so
// a route that throws loses its writes, as it would in production.
async function withApp(test: (app: Express, db: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
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

function minutesFromNow(minutes: number, seconds = 0): Date {
  return new Date(Date.now() + (minutes * 60 + seconds) * 1000);
}

// An operator with an active session, the production car rate ($230) and a
// grace period of 5 minutes since 10 minutes ago, and a car that entered at
// the given time. The SAL plate is only for these tests.
async function carInside(db: Prisma.TransactionClient, entryTime: Date) {
  const user = await db.user.create({
    data: {
      name: "Operador de la salida",
      email: "operador.salida@example.com",
      passwordHash: "not-a-real-hash",
      role: "OPERATOR",
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
  const ratesFrom = minutesFromNow(-10);
  const rate = await setRate(db, {
    vehicleType: "CAR",
    valuePerMinute: 230,
    createdById: user.id,
    now: ratesFrom,
  });
  const grace = await setGracePeriod(db, { minutes: 5, createdById: user.id, now: ratesFrom });
  if (!rate.ok || !grace.ok) throw new Error("setup failed");
  const entry = await registerEntry(db, {
    plate: "SAL123",
    vehicleType: "CAR",
    color: "Gris",
    userId: user.id,
    ip: IP,
    now: entryTime,
  });
  if (!entry.ok) throw new Error("setup failed");
  return { user, stayId: entry.stayId, cookie: `sesion=${TOKEN}` };
}

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function postExit(app: Express, id: number | string, cookie?: string, body: object = {}) {
  const req = request(app)
    .post(`/api/estadias/${id}/salida`)
    .set("Origin", ORIGIN)
    .set("X-Forwarded-For", IP);
  return (cookie === undefined ? req : req.set("Cookie", cookie)).send(body);
}

describe("POST /api/estadias/{id}/salida (FR-12 to FR-14, ADR 0008)", () => {
  it("registers the exit and answers 201 with the receipt in Spanish (BR-14)", async () => {
    await withApp(async (app, db) => {
      const entryTime = minutesFromNow(-6, -10);
      const { user, stayId, cookie } = await carInside(db, entryTime);
      // Skips a receipt number (gaps are allowed, data model 3.1, decision 3),
      // so the number of the receipt and its id differ.
      await db.$queryRawUnsafe("SELECT nextval('comprobante_consecutivo_seq')");
      const before = Date.now();

      const response = await postExit(app, stayId, cookie);

      expect(response.status).toBe(201);
      const receipt = await db.receipt.findUniqueOrThrow({ where: { stayId } });
      // 6 full minutes at $230 is $1,380, rounded down to $1,350 (BR-07).
      expect(response.body).toEqual({
        consecutivo: receipt.number,
        estadiaId: stayId,
        placa: "SAL123",
        tipoVehiculo: "CARRO",
        horaIngreso: entryTime.toISOString(),
        horaSalida: expect.any(String),
        minutosCompletos: 6,
        valorMinuto: 230,
        subtotal: 1380,
        ajusteRedondeo: 30,
        total: 1350,
      });
      const exitTime = new Date(response.body.horaSalida).getTime();
      expect(exitTime).toBeGreaterThanOrEqual(before);
      expect(exitTime).toBeLessThanOrEqual(Date.now());
      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "EXIT_REGISTERED", entity: "estadia", entityId: stayId },
      });
      expect(event).toMatchObject({ userId: user.id, ip: IP });
    });
  });

  it("ignores an exit time sent by the client (BR-16)", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await carInside(db, minutesFromNow(-6, -10));

      const response = await postExit(app, stayId, cookie, {
        horaSalida: "2099-01-01T00:00:00.000Z",
        total: 0,
      });

      expect(response.status).toBe(201);
      expect(response.body.horaSalida).not.toBe("2099-01-01T00:00:00.000Z");
      expect(response.body.total).toBe(1350);
    });
  });

  it("answers 404 for a stay that does not exist", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await carInside(db, minutesFromNow(-6, -10));

      const response = await postExit(app, stayId + 1000, cookie);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: { codigo: "NO_ENCONTRADO", mensaje: "La estadía no existe." },
      });
    });
  });

  it("answers 409 ESTADIA_NO_ACTIVA to a second exit of the same stay", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await carInside(db, minutesFromNow(-6, -10));
      const first = await postExit(app, stayId, cookie);

      const response = await postExit(app, stayId, cookie);

      expect(first.status).toBe(201);
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          codigo: "ESTADIA_NO_ACTIVA",
          mensaje: "La estadía ya no está activa: puede que ya se haya registrado su salida.",
        },
      });
      expect(await db.receipt.count({ where: { stayId } })).toBe(1);
    });
  });

  // A clock that went back leaves the entry after the exit: calculateFee
  // throws, and the error handler answers without details (NFR-07, A-23).
  it("answers 500 ERROR_INTERNO when calculateFee throws, and writes nothing", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await carInside(db, minutesFromNow(60));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await postExit(app, stayId, cookie);

      expect(response.status).toBe(500);
      expect(log).toHaveBeenCalledWith("Unhandled error", expect.any(RangeError));
      expect(response.body).toEqual({
        error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado." },
      });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay).toMatchObject({ status: "ACTIVE", exitTime: null });
      expect(await db.receipt.count({ where: { stayId } })).toBe(0);
    });
  });
});

describe("POST /api/estadias/{id}/salida validation (NFR-06)", () => {
  it.each(["abc", "0", "-1", "1.5", "1e3", "01", "2147483648"])(
    "answers 400 ENTRADA_INVALIDA to the id %s",
    async (id) => {
      await withApp(async (app, db) => {
        const { cookie } = await carInside(db, minutesFromNow(-6, -10));

        const response = await postExit(app, id, cookie);

        expect(response.status).toBe(400);
        expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      });
    },
  );

  // Passes since the green of cycle M, on purpose: whoever has no session does
  // not learn how the id is validated.
  it("answers 401 before validating the id of a request without a session", async () => {
    await withApp(async (app) => {
      const response = await postExit(app, "abc");

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });

  // Passes since the green of cycle M, on purpose: the Origin check of app.ts
  // also covers this route (docs/modelo-amenazas.md, 7.4).
  it("rejects an exit without Origin and leaves the stay active", async () => {
    await withApp(async (app, db) => {
      const { stayId, cookie } = await carInside(db, minutesFromNow(-6, -10));

      const response = await request(app)
        .post(`/api/estadias/${stayId}/salida`)
        .set("Cookie", cookie)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay.status).toBe("ACTIVE");
    });
  });
});

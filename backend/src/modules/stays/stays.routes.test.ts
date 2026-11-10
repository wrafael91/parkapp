import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { hashSessionToken } from "../accounts/session-token.js";
import { setGracePeriod, setRate } from "../rates/rate-settings.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => {
  vi.restoreAllMocks();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const IP = "198.51.100.41";
const TOKEN = "token-de-prueba-de-las-rutas-de-estadias-0001";

// Like the session routes, each test runs as parkapp_app and always rolls back.
// The route's transaction is a savepoint inside the test transaction, so a
// route that throws loses its writes, as it would in production.
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

// An operator with an active session, plus the rates and the grace period that
// every entry needs (BR-11). Returns the Cookie header the browser would send.
async function signedInOperator(db: Prisma.TransactionClient) {
  const user = await db.user.create({
    data: {
      name: "Operador de rutas",
      email: "operador.rutas@example.com",
      passwordHash: "not-a-real-hash",
      role: "OPERATOR",
    },
  });
  const now = new Date();
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(TOKEN),
      ip: IP,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
  });
  const car = await setRate(db, {
    vehicleType: "CAR",
    valuePerMinute: 200,
    createdById: user.id,
    now,
  });
  const motorcycle = await setRate(db, {
    vehicleType: "MOTORCYCLE",
    valuePerMinute: 150,
    createdById: user.id,
    now,
  });
  const grace = await setGracePeriod(db, { minutes: 5, createdById: user.id, now });
  if (!car.ok || !motorcycle.ok || !grace.ok) throw new Error("setup failed");
  return { user, cookie: `sesion=${TOKEN}` };
}

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function postEntry(app: Express, body: object, cookie?: string) {
  const req = request(app).post("/api/estadias").set("Origin", ORIGIN).set("X-Forwarded-For", IP);
  return (cookie === undefined ? req : req.set("Cookie", cookie)).send(body);
}

const CAR = { placa: "tst-123", tipoVehiculo: "CARRO", color: " Rojo ", marca: " Mazda " };

describe("POST /api/estadias (FR-07, ADR 0008)", () => {
  it("registers the entry and answers 201 with the stay in Spanish", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedInOperator(db);
      const before = Date.now();

      const response = await postEntry(app, CAR, cookie);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(Number),
        placa: "TST123",
        tipoVehiculo: "CARRO",
        color: "Rojo",
        marca: "Mazda",
        horaIngreso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: response.body.id } });
      expect(stay).toMatchObject({ status: "ACTIVE", entryById: user.id });
      expect(stay.entryTime.toISOString()).toBe(response.body.horaIngreso);
      expect(stay.entryTime.getTime()).toBeGreaterThanOrEqual(before);
      // NFR-12: the event carries the client IP that Nginx sends (A-25).
      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "ENTRY_REGISTERED", entityId: stay.id },
      });
      expect(event).toMatchObject({ userId: user.id, ip: IP });
    });
  });

  it("registers a motorcycle without a brand and answers marca null", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedInOperator(db);

      const response = await postEntry(
        app,
        { placa: "TST12A", tipoVehiculo: "MOTO", color: "Negro" },
        cookie,
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ placa: "TST12A", tipoVehiculo: "MOTO", marca: null });
    });
  });

  it("ignores an entry time sent by the client (BR-16)", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedInOperator(db);

      const response = await postEntry(
        app,
        { ...CAR, horaIngreso: "2020-01-01T00:00:00.000Z" },
        cookie,
      );

      expect(response.status).toBe(201);
      expect(response.body.horaIngreso).not.toBe("2020-01-01T00:00:00.000Z");
      expect(new Date(response.body.horaIngreso).getFullYear()).toBeGreaterThan(2020);
    });
  });

  it.each([
    ["no cookie", undefined],
    ["an unknown token", "sesion=token-inventado"],
  ])(
    "answers a request with %s with 401 NO_AUTENTICADO and registers nothing",
    async (_case, cookie) => {
      await withApp(async (app, db) => {
        await signedInOperator(db);

        const response = await postEntry(app, CAR, cookie);

        expect(response.status).toBe(401);
        expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
        expect(await db.stay.count({ where: { plate: "TST123" } })).toBe(0);
      });
    },
  );
});

describe("POST /api/estadias validation (NFR-06, FR-08)", () => {
  it.each([
    ["no plate", { tipoVehiculo: "CARRO", color: "Rojo" }],
    ["a plate over 20 characters", { ...CAR, placa: "A".repeat(21) }],
    ["an unknown vehicle type", { ...CAR, tipoVehiculo: "BICICLETA" }],
    ["the internal vehicle type", { ...CAR, tipoVehiculo: "CAR" }],
    ["a color with only spaces", { ...CAR, color: "   " }],
    ["a color over 30 characters", { ...CAR, color: "a".repeat(31) }],
    ["a brand over 40 characters", { ...CAR, marca: "a".repeat(41) }],
    ["a brand that is not text", { ...CAR, marca: 7 }],
    ["a car plate with the motorcycle format", { ...CAR, placa: "TST12A" }],
    ["a motorcycle plate with the car format", { ...CAR, tipoVehiculo: "MOTO" }],
  ])("rejects a body with %s with 400 ENTRADA_INVALIDA", async (_case, body) => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedInOperator(db);

      const response = await postEntry(app, body, cookie);

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      expect(await db.stay.count({ where: { entryById: user.id } })).toBe(0);
      expect(await db.auditEvent.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  it("rejects an entry without Origin before touching the database (section 7.4)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await withApp(async (app, db) => {
      const { user, cookie } = await signedInOperator(db);

      const response = await request(app)
        .post("/api/estadias")
        .set("X-Forwarded-For", IP)
        .set("Cookie", cookie)
        .send(CAR);

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      expect(await db.stay.count({ where: { entryById: user.id } })).toBe(0);
    });
  });

  it("answers 401 before validating the body of a request without a session", async () => {
    await withApp(async (app) => {
      const response = await postEntry(app, { placa: "" });

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });
});

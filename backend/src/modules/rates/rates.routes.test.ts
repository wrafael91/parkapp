// Tests of /api/tarifas and /api/periodo-gracia (rates.routes.ts).
import type { Express } from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient, Role } from "../../generated/prisma/client.js";
import { hashSessionToken } from "../accounts/session-token.js";
import { registerEntry } from "../stays/entry.service.js";
import { registerExit } from "../stays/exit.service.js";
import { setGracePeriod, setRate } from "./rate-settings.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const IP = "198.51.100.42";
const TOKEN = "token-de-prueba-de-las-rutas-de-tarifas-0001";

// Like the other route tests, each test runs as parkapp_app and always rolls
// back. The route's transaction is a savepoint inside the test transaction.
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

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

// A user with an active session, and the production values ($230, $161 and 5
// minutes) loaded 10 minutes ago by the bootstrap script.
async function signedIn(db: Prisma.TransactionClient, role: Role) {
  const user = await db.user.create({
    data: {
      name: role === "ADMINISTRATOR" ? "Administrador de tarifas" : "Operador de tarifas",
      email: "rutas.tarifas@example.com",
      passwordHash: "not-a-real-hash",
      role,
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
  const loadedAt = minutesFromNow(-10);
  const car = await setRate(db, {
    vehicleType: "CAR",
    valuePerMinute: 230,
    createdById: user.id,
    now: loadedAt,
  });
  const motorcycle = await setRate(db, {
    vehicleType: "MOTORCYCLE",
    valuePerMinute: 161,
    createdById: user.id,
    now: loadedAt,
  });
  const grace = await setGracePeriod(db, { minutes: 5, createdById: user.id, now: loadedAt });
  if (!car.ok || !motorcycle.ok || !grace.ok) throw new Error("setup failed");
  return { user, loadedAt, cookie: `sesion=${TOKEN}` };
}

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function get(app: Express, url: string, cookie?: string) {
  const req = request(app).get(url).set("X-Forwarded-For", IP);
  return cookie === undefined ? req : req.set("Cookie", cookie);
}

function post(app: Express, url: string, cookie: string | undefined, body: object) {
  const req = request(app).post(url).set("Origin", ORIGIN).set("X-Forwarded-For", IP);
  return (cookie === undefined ? req : req.set("Cookie", cookie)).send(body);
}

describe("GET /api/tarifas and GET /api/periodo-gracia (FR-16, FR-17)", () => {
  it("answers the current rate of each vehicle type with its legal cap", async () => {
    await withApp(async (app, db) => {
      const { loadedAt, cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await get(app, "/api/tarifas", cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        tarifas: [
          {
            tipoVehiculo: "CARRO",
            valorMinuto: 230,
            topeLegal: 230,
            vigenteDesde: loadedAt.toISOString(),
          },
          {
            tipoVehiculo: "MOTO",
            valorMinuto: 161,
            topeLegal: 161,
            vigenteDesde: loadedAt.toISOString(),
          },
        ],
      });
    });
  });

  it("answers the current grace period", async () => {
    await withApp(async (app, db) => {
      const { loadedAt, cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await get(app, "/api/periodo-gracia", cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ minutos: 5, vigenteDesde: loadedAt.toISOString() });
    });
  });
});

describe("POST /api/tarifas (FR-16, BR-10, BR-11)", () => {
  it("creates a version valid from now, keeps the previous one and logs the user and the IP", async () => {
    await withApp(async (app, db) => {
      const { user, loadedAt, cookie } = await signedIn(db, "ADMINISTRATOR");
      const previous = await db.rate.findFirstOrThrow({
        where: { vehicleType: "CAR", validTo: null },
      });
      const before = Date.now();

      const response = await post(app, "/api/tarifas", cookie, {
        tipoVehiculo: "CARRO",
        valorMinuto: 200,
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        tipoVehiculo: "CARRO",
        valorMinuto: 200,
        topeLegal: 230,
        vigenteDesde: expect.any(String),
      });
      const validFrom = new Date(response.body.vigenteDesde).getTime();
      expect(validFrom).toBeGreaterThanOrEqual(before);
      const closed = await db.rate.findUniqueOrThrow({ where: { id: previous.id } });
      expect(closed).toMatchObject({ valuePerMinute: 230, validFrom: loadedAt });
      expect(closed.validTo?.getTime()).toBe(validFrom);
      const created = await db.rate.findFirstOrThrow({
        where: { vehicleType: "CAR", validTo: null },
      });
      expect(created).toMatchObject({ valuePerMinute: 200, createdById: user.id });
      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "RATE_CHANGED", entityId: created.id },
      });
      expect(event).toMatchObject({ userId: user.id, ip: IP });
    });
  });

  it("rejects a rate above the legal cap with 400 TARIFA_SUPERA_TOPE and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");
      const ratesBefore = await db.rate.count();

      const response = await post(app, "/api/tarifas", cookie, {
        tipoVehiculo: "MOTO",
        valorMinuto: 200,
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          codigo: "TARIFA_SUPERA_TOPE",
          mensaje: "La tarifa supera el tope legal vigente ($161 por minuto).",
        },
      });
      expect(await db.rate.count()).toBe(ratesBefore);
    });
  });

  it.each([
    ["zero", { tipoVehiculo: "CARRO", valorMinuto: 0 }],
    ["negative", { tipoVehiculo: "CARRO", valorMinuto: -50 }],
    ["with cents", { tipoVehiculo: "CARRO", valorMinuto: 200.5 }],
    ["a string", { tipoVehiculo: "CARRO", valorMinuto: "200" }],
    ["an unknown vehicle type", { tipoVehiculo: "BUS", valorMinuto: 200 }],
    ["without a value", { tipoVehiculo: "CARRO" }],
  ])("rejects a rate %s with 400 ENTRADA_INVALIDA and changes nothing", async (_case, body) => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");
      const ratesBefore = await db.rate.count();

      const response = await post(app, "/api/tarifas", cookie, body);

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      expect(await db.rate.count()).toBe(ratesBefore);
    });
  });
});

describe("POST /api/periodo-gracia (FR-17, BR-08, BR-11)", () => {
  it("creates a version valid from now and logs the user and the IP", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await post(app, "/api/periodo-gracia", cookie, { minutos: 10 });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ minutos: 10, vigenteDesde: expect.any(String) });
      const created = await db.gracePeriod.findFirstOrThrow({ where: { validTo: null } });
      expect(created).toMatchObject({ minutes: 10, createdById: user.id });
      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "GRACE_PERIOD_CHANGED", entityId: created.id },
      });
      expect(event).toMatchObject({ userId: user.id, ip: IP });
    });
  });

  it("accepts zero minutes (RI-10)", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await post(app, "/api/periodo-gracia", cookie, { minutos: 0 });

      expect(response.status).toBe(201);
      expect(response.body.minutos).toBe(0);
    });
  });

  it.each([
    ["negative", { minutos: -1 }],
    ["not whole", { minutos: 2.5 }],
    ["a string", { minutos: "5" }],
    ["missing", {}],
  ])("rejects minutes %s with 400 ENTRADA_INVALIDA and changes nothing", async (_case, body) => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");
      const versionsBefore = await db.gracePeriod.count();

      const response = await post(app, "/api/periodo-gracia", cookie, body);

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      expect(await db.gracePeriod.count()).toBe(versionsBefore);
    });
  });
});

describe("a change does not touch the stays inside (BR-11)", () => {
  it("a car that entered before the change pays the rate and the grace it entered with", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(db, "ADMINISTRATOR");
      const entry = await registerEntry(db, {
        plate: "TAR123",
        vehicleType: "CAR",
        color: "Gris",
        userId: user.id,
        ip: IP,
        now: minutesFromNow(-6),
      });
      if (!entry.ok) throw new Error("setup failed");

      const rate = await post(app, "/api/tarifas", cookie, {
        tipoVehiculo: "CARRO",
        valorMinuto: 200,
      });
      const grace = await post(app, "/api/periodo-gracia", cookie, { minutos: 10 });
      const exit = await registerExit(db, {
        stayId: entry.stayId,
        userId: user.id,
        ip: IP,
        now: new Date(),
      });

      expect([rate.status, grace.status]).toEqual([201, 201]);
      if (!exit.ok) throw new Error("exit failed");
      const receipt = await db.receipt.findUniqueOrThrow({ where: { id: exit.receiptId } });
      // 6 minutes at $230, past the 5 minutes of grace: $1,380 → $1,350 (BR-07).
      // With $200 and 10 minutes it would be $0.
      expect(receipt).toMatchObject({ fullMinutes: 6, subtotal: 1380, total: 1350 });
    });
  });
});

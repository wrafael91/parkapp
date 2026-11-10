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

describe("POST /api/estadias with a plate that is already inside (BR-03, FR-09)", () => {
  it("answers 409 PLACA_ACTIVA and keeps the audit event", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedInOperator(db);
      const first = await postEntry(app, CAR, cookie);

      const response = await postEntry(app, { ...CAR, color: "Azul" }, cookie);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          codigo: "PLACA_ACTIVA",
          mensaje: "La placa ya tiene una estadía activa: posible placa clonada.",
        },
      });
      expect(await db.stay.count({ where: { plate: "TST123" } })).toBe(1);
      // The rejection is committed, not rolled back: the event stays in the log.
      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "ENTRY_REJECTED_ACTIVE_PLATE", userId: user.id },
      });
      expect(event).toMatchObject({ entityId: first.body.id, ip: IP });
      expect(event.detail).toEqual({ tipo_vehiculo: "CARRO", color: "Azul", marca: "Mazda" });
    });
  });
});

// Browsers may leave out Origin in a same-origin GET, and the check only covers
// the methods that change data (docs/modelo-amenazas.md, 7.4).
function getStays(app: Express, query: string, cookie?: string) {
  const req = request(app).get(`/api/estadias${query}`).set("X-Forwarded-For", IP);
  return cookie === undefined ? req : req.set("Cookie", cookie);
}

// Registers an entry at a given minute from now, without going through the route.
async function entryAt(
  db: Prisma.TransactionClient,
  input: { plate: string; vehicleType: "CAR" | "MOTORCYCLE"; brand?: string; userId: number },
  at: Date,
) {
  const result = await registerEntry(db, { ...input, color: "Gris", ip: IP, now: at });
  if (!result.ok) throw new Error("setup failed");
  return result.stayId;
}

describe("GET /api/estadias?estado=ACTIVA (FR-10, US-07)", () => {
  it("lists the vehicles inside of every user, newest first, as the 201 does", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedInOperator(db);
      const admin = await db.user.create({
        data: {
          name: "Administrador de rutas",
          email: "admin.rutas@example.com",
          passwordHash: "not-a-real-hash",
          role: "ADMINISTRATOR",
        },
      });
      const start = Date.now();
      const at = (minutes: number) => new Date(start + minutes * 60_000);
      const first = await entryAt(
        db,
        { plate: "TST101", vehicleType: "CAR", brand: "Mazda", userId: user.id },
        at(1),
      );
      const third = await entryAt(
        db,
        { plate: "TST10A", vehicleType: "MOTORCYCLE", userId: admin.id },
        at(3),
      );
      const second = await entryAt(
        db,
        { plate: "TST102", vehicleType: "CAR", brand: "Kia", userId: user.id },
        at(2),
      );
      const closed = await entryAt(
        db,
        { plate: "TST103", vehicleType: "CAR", userId: user.id },
        at(4),
      );
      await db.stay.update({
        where: { id: closed },
        data: { status: "CLOSED", exitTime: at(5), exitById: user.id },
      });
      const voided = await entryAt(
        db,
        { plate: "TST104", vehicleType: "CAR", userId: user.id },
        at(5),
      );
      await db.stay.update({
        where: { id: voided },
        data: { status: "VOIDED", voidedAt: at(6), voidedById: admin.id, voidReason: "Prueba" },
      });

      const response = await getStays(app, "?estado=ACTIVA", cookie);

      expect(response.status).toBe(200);
      // A development database may have other stays inside: only these are checked.
      const ids = [first, second, third, closed, voided];
      const ours = response.body.estadias.filter((stay: { id: number }) => ids.includes(stay.id));
      expect(ours).toEqual([
        {
          id: third,
          placa: "TST10A",
          tipoVehiculo: "MOTO",
          color: "Gris",
          marca: null,
          horaIngreso: at(3).toISOString(),
        },
        {
          id: second,
          placa: "TST102",
          tipoVehiculo: "CARRO",
          color: "Gris",
          marca: "Kia",
          horaIngreso: at(2).toISOString(),
        },
        {
          id: first,
          placa: "TST101",
          tipoVehiculo: "CARRO",
          color: "Gris",
          marca: "Mazda",
          horaIngreso: at(1).toISOString(),
        },
      ]);
    });
  });

  it("puts the newest stay first when two entered at the same instant", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedInOperator(db);
      const at = new Date(Date.now() + 60_000);
      const older = await entryAt(db, { plate: "TST111", vehicleType: "CAR", userId: user.id }, at);
      const newer = await entryAt(db, { plate: "TST112", vehicleType: "CAR", userId: user.id }, at);

      const response = await getStays(app, "?estado=ACTIVA", cookie);

      const ids = response.body.estadias
        .map((stay: { id: number }) => stay.id)
        .filter((id: number) => id === older || id === newer);
      expect(ids).toEqual([newer, older]);
    });
  });

  it.each([
    ["no cookie", undefined],
    ["an unknown token", "sesion=token-inventado"],
  ])("answers a list request with %s with 401 NO_AUTENTICADO", async (_case, cookie) => {
    await withApp(async (app, db) => {
      const { user } = await signedInOperator(db);
      await entryAt(db, { plate: "TST121", vehicleType: "CAR", userId: user.id }, new Date());

      const response = await getStays(app, "?estado=ACTIVA", cookie);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: { codigo: "NO_AUTENTICADO", mensaje: "No hay una sesión activa." },
      });
    });
  });
});

describe("GET /api/estadias query validation (NFR-06)", () => {
  it.each([
    ["no estado", ""],
    ["estado=CERRADA", "?estado=CERRADA"],
    ["the state in lowercase", "?estado=activa"],
    ["the internal state", "?estado=ACTIVE"],
    ["estado twice", "?estado=ACTIVA&estado=ACTIVA"],
  ])("rejects a list request with %s with 400 ENTRADA_INVALIDA", async (_case, query) => {
    await withApp(async (app, db) => {
      const { cookie } = await signedInOperator(db);

      const response = await getStays(app, query, cookie);

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
    });
  });

  it("answers 401 before validating the query of a request without a session", async () => {
    await withApp(async (app) => {
      const response = await getStays(app, "");

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });
});

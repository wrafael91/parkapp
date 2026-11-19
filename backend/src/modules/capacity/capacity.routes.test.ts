// Tests of /api/cupos (capacity.routes.ts).
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
import { registerEntry } from "../stays/entry.service.js";
import { registerExit } from "../stays/exit.service.js";
import { setCapacity } from "./capacity.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const IP = "198.51.100.43";
const TOKEN = "token-de-prueba-de-las-rutas-de-cupos-00001";
const URL = "/api/cupos";

// Like the other route tests, each test runs as parkapp_app and always rolls
// back. The route's transaction is a savepoint inside the test transaction. The
// versions in force in a development database are closed first, so spaces
// loaded there do not change these tests.
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

// A user with an active session. Without spaces, as in production before the
// administrator sets them.
async function signedIn(db: Prisma.TransactionClient, role: Role) {
  const user = await db.user.create({
    data: {
      name: role === "ADMINISTRATOR" ? "Administrador de cupos" : "Operador de cupos",
      email: "rutas.cupos@example.com",
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
  return { user, changedBy: { userId: user.id, ip: IP }, cookie: `sesion=${TOKEN}` };
}

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function get(app: Express, cookie?: string) {
  const req = request(app).get(URL).set("X-Forwarded-For", IP);
  return cookie === undefined ? req : req.set("Cookie", cookie);
}

function post(app: Express, cookie: string | undefined, body: object) {
  const req = request(app).post(URL).set("Origin", ORIGIN).set("X-Forwarded-For", IP);
  return (cookie === undefined ? req : req.set("Cookie", cookie)).send(body);
}

function capacityEvents(db: Prisma.TransactionClient) {
  return db.auditEvent.count({ where: { action: "CAPACITY_CHANGED" } });
}

// The vehicles of a type already inside, so a development database with active
// stays does not change the results.
function inside(db: Prisma.TransactionClient, vehicleType: "CAR" | "MOTORCYCLE") {
  return db.stay.count({ where: { vehicleType, status: "ACTIVE" } });
}

// Two cars inside, one car that left and one voided, plus the rates and the grace
// period that every entry needs (BR-11).
async function carsInAndOut(db: Prisma.TransactionClient, userId: number) {
  const now = minutesFromNow(-60);
  await setRate(db, { vehicleType: "CAR", valuePerMinute: 230, createdById: userId, now });
  await setGracePeriod(db, { minutes: 5, createdById: userId, now });
  const ids: number[] = [];
  for (const plate of ["TST201", "TST202", "TST203", "TST204"]) {
    const entry = await registerEntry(db, {
      plate,
      vehicleType: "CAR",
      color: "Gris",
      userId,
      ip: IP,
      now: minutesFromNow(-30),
    });
    if (!entry.ok) throw new Error("setup failed");
    ids.push(entry.stayId);
  }
  await registerExit(db, { stayId: ids[2]!, userId, ip: IP, now: minutesFromNow(-10) });
  await db.stay.update({
    where: { id: ids[3]! },
    data: {
      status: "VOIDED",
      voidedAt: minutesFromNow(-10),
      voidedById: userId,
      voidReason: "Ingreso de prueba",
    },
  });
}

describe("GET /api/cupos (FR-24)", () => {
  it("shows an operator only the vehicles inside when no spaces are set", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "OPERATOR");
      const cars = await inside(db, "CAR");
      const motorcycles = await inside(db, "MOTORCYCLE");

      const response = await get(app, cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        cupos: [
          { tipoVehiculo: "CARRO", cupos: null, ocupados: cars, libres: null },
          { tipoVehiculo: "MOTO", cupos: null, ocupados: motorcycles, libres: null },
        ],
      });
    });
  });

  it("counts only the active stays, and shows the free spaces of each type", async () => {
    await withApp(async (app, db) => {
      const { user, changedBy, cookie } = await signedIn(db, "ADMINISTRATOR");
      const carsBefore = await inside(db, "CAR");
      await carsInAndOut(db, user.id);
      const at = minutesFromNow(-5);
      await setCapacity(db, { vehicleType: "CAR", spaces: carsBefore + 5, now: at, changedBy });
      await setCapacity(db, { vehicleType: "MOTORCYCLE", spaces: 0, now: at, changedBy });
      const motorcycles = await inside(db, "MOTORCYCLE");

      const response = await get(app, cookie);

      expect(response.status).toBe(200);
      expect(response.body.cupos).toEqual([
        { tipoVehiculo: "CARRO", cupos: carsBefore + 5, ocupados: carsBefore + 2, libres: 3 },
        { tipoVehiculo: "MOTO", cupos: 0, ocupados: motorcycles, libres: 0 },
      ]);
    });
  });

  it("shows 0 free spaces, not fewer, when the spaces are below the vehicles inside", async () => {
    await withApp(async (app, db) => {
      const { user, changedBy, cookie } = await signedIn(db, "OPERATOR");
      const carsBefore = await inside(db, "CAR");
      await carsInAndOut(db, user.id);
      await setCapacity(db, {
        vehicleType: "CAR",
        spaces: carsBefore + 1,
        now: minutesFromNow(-5),
        changedBy,
      });

      const response = await get(app, cookie);

      expect(response.body.cupos[0]).toEqual({
        tipoVehiculo: "CARRO",
        cupos: carsBefore + 1,
        ocupados: carsBefore + 2,
        libres: 0,
      });
    });
  });

  it("answers 401 without a session", async () => {
    await withApp(async (app) => {
      const response = await get(app);

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });
});

describe("POST /api/cupos sets the spaces of a type (FR-24, BR-19)", () => {
  it("creates a version valid from now, closes the previous one and logs the user and the IP", async () => {
    await withApp(async (app, db) => {
      const { user, changedBy, cookie } = await signedIn(db, "ADMINISTRATOR");
      const previous = await setCapacity(db, {
        vehicleType: "CAR",
        spaces: 16,
        now: minutesFromNow(-10),
        changedBy,
      });
      if (!previous.ok || previous.capacityId === null) throw new Error("setup failed");
      const cars = await inside(db, "CAR");
      const before = Date.now();

      const response = await post(app, cookie, { tipoVehiculo: "CARRO", cupos: cars + 30 });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        tipoVehiculo: "CARRO",
        cupos: cars + 30,
        ocupados: cars,
        libres: 30,
      });
      const created = await db.capacity.findFirstOrThrow({
        where: { vehicleType: "CAR", validTo: null },
      });
      expect(created).toMatchObject({ spaces: cars + 30, createdById: user.id });
      expect(created.validFrom.getTime()).toBeGreaterThanOrEqual(before);
      const closed = await db.capacity.findUniqueOrThrow({ where: { id: previous.capacityId } });
      expect(closed).toMatchObject({ spaces: 16, validTo: created.validFrom });
      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "CAPACITY_CHANGED", entityId: created.id },
      });
      expect(event).toMatchObject({ userId: user.id, entity: "cupo", ip: IP });
    });
  });

  it.each([0, 10_000])("accepts %i spaces (RI-21)", async (cupos) => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await post(app, cookie, { tipoVehiculo: "MOTO", cupos });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ tipoVehiculo: "MOTO", cupos });
    });
  });

  it.each([
    ["-1 spaces", { tipoVehiculo: "CARRO", cupos: -1 }],
    ["10,001 spaces", { tipoVehiculo: "CARRO", cupos: 10_001 }],
    ["spaces that are not whole", { tipoVehiculo: "CARRO", cupos: 2.5 }],
    ["spaces as a string", { tipoVehiculo: "CARRO", cupos: "30" }],
    ["no spaces", { tipoVehiculo: "CARRO" }],
    ["another vehicle type", { tipoVehiculo: "BICICLETA", cupos: 30 }],
    ["no vehicle type", { cupos: 30 }],
  ])("answers 400 to %s and changes nothing", async (_case, body) => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await post(app, cookie, body);

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      expect(await db.capacity.count({ where: { validTo: null } })).toBe(0);
      expect(await capacityEvents(db)).toBe(0);
    });
  });

  it("answers 409 CUPOS_CAMBIARON when another administrator saved first, and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { changedBy, cookie } = await signedIn(db, "ADMINISTRATOR");
      // A version that starts after this request: as if another administrator had
      // saved while this request waited for the lock.
      await setCapacity(db, { vehicleType: "CAR", spaces: 16, now: minutesFromNow(5), changedBy });

      const response = await post(app, cookie, { tipoVehiculo: "CARRO", cupos: 30 });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          codigo: "CUPOS_CAMBIARON",
          mensaje:
            "Otro administrador cambió los cupos al mismo tiempo. Revisa los valores y vuelve a guardar.",
        },
      });
      expect(await db.capacity.findFirst({ where: { validTo: null } })).toMatchObject({
        spaces: 16,
      });
      expect(await capacityEvents(db)).toBe(1);
    });
  });
});

describe("POST /api/cupos removes the limit of a type (FR-24, BR-19)", () => {
  it("closes the current version without creating one and logs the user and the IP", async () => {
    await withApp(async (app, db) => {
      const { user, changedBy, cookie } = await signedIn(db, "ADMINISTRATOR");
      const set = await setCapacity(db, {
        vehicleType: "MOTORCYCLE",
        spaces: 250,
        now: minutesFromNow(-10),
        changedBy,
      });
      if (!set.ok || set.capacityId === null) throw new Error("setup failed");
      const motorcycles = await inside(db, "MOTORCYCLE");

      const response = await post(app, cookie, { tipoVehiculo: "MOTO", cupos: null });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        tipoVehiculo: "MOTO",
        cupos: null,
        ocupados: motorcycles,
        libres: null,
      });
      expect(await db.capacity.count({ where: { validTo: null } })).toBe(0);
      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "CAPACITY_CHANGED", userId: user.id, entityId: set.capacityId },
        orderBy: { id: "desc" },
      });
      expect(event).toMatchObject({ entity: "cupo", ip: IP });
      expect(await capacityEvents(db)).toBe(2);
    });
  });

  it("answers 409 SIN_CUPOS_CONFIGURADOS when the type has no limit, and logs nothing", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await post(app, cookie, { tipoVehiculo: "CARRO", cupos: null });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          codigo: "SIN_CUPOS_CONFIGURADOS",
          mensaje: "Ese tipo de vehículo no tiene cupos configurados.",
        },
      });
      expect(await capacityEvents(db)).toBe(0);
    });
  });
});

describe("access to POST /api/cupos (NFR-05, matrix 1.2)", () => {
  it("answers 401 without a session, before the body is validated", async () => {
    await withApp(async (app, db) => {
      const valid = await post(app, undefined, { tipoVehiculo: "CARRO", cupos: 30 });
      const invalid = await post(app, undefined, { cupos: "x" });

      expect(valid.status).toBe(401);
      expect(valid.body.error.codigo).toBe("NO_AUTENTICADO");
      expect(invalid.status).toBe(401);
      expect(await capacityEvents(db)).toBe(0);
    });
  });

  it("answers an operator 403, before the body is validated, logs ACCESO_DENEGADO and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(db, "OPERATOR");

      const valid = await post(app, cookie, { tipoVehiculo: "CARRO", cupos: 30 });
      const invalid = await post(app, cookie, { cupos: "x" });

      expect(valid.status).toBe(403);
      expect(valid.body).toEqual({
        error: { codigo: "ACCESO_DENEGADO", mensaje: "No tienes permiso para esta acción." },
      });
      expect(invalid.status).toBe(403);
      const events = await db.auditEvent.findMany({
        where: { action: "ACCESS_DENIED", userId: user.id },
      });
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ detail: { metodo: "POST", ruta: URL }, ip: IP });
      expect(await db.capacity.count({ where: { validTo: null } })).toBe(0);
      expect(await capacityEvents(db)).toBe(0);
    });
  });

  // Passes from the start, on purpose: the Origin check of app.ts runs before
  // every route (docs/modelo-amenazas.md, 7.4).
  it("a change without Origin answers 403 ORIGEN_NO_PERMITIDO and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await request(app)
        .post(URL)
        .set("Cookie", cookie)
        .send({ tipoVehiculo: "CARRO", cupos: 30 });

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      expect(await db.capacity.count({ where: { validTo: null } })).toBe(0);
    });
  });
});

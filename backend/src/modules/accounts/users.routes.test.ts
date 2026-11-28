// Tests of /api/usuarios (users.routes.ts).
import type { Express } from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient, Role } from "../../generated/prisma/client.js";
import { createOperator } from "./operator-accounts.js";
import { signIn } from "./session.service.js";
import { hashSessionToken } from "./session-token.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const IP = "198.51.100.43";
const TOKEN = "token-de-prueba-de-las-rutas-de-cuentas-0001";
const URL = "/api/usuarios";
const EMAIL = "operador.rutas@example.com";
const PASSWORD = "la contraseña inicial de las rutas";

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

// A user with an active session.
async function signedIn(db: Prisma.TransactionClient, role: Role) {
  const user = await db.user.create({
    data: {
      name: role === "ADMINISTRATOR" ? "Administrador de cuentas" : "Operador con sesión",
      email: "rutas.cuentas@example.com",
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
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { user, cookie: `sesion=${TOKEN}` };
}

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function get(app: Express, cookie?: string) {
  const req = request(app).get(URL).set("X-Forwarded-For", IP);
  return cookie === undefined ? req : req.set("Cookie", cookie);
}

function post(app: Express, url: string, cookie: string | undefined, body: object) {
  const req = request(app).post(url).set("Origin", ORIGIN).set("X-Forwarded-For", IP);
  return (cookie === undefined ? req : req.set("Cookie", cookie)).send(body);
}

const NEW_ACCOUNT = { nombre: "Operador de las rutas", correo: EMAIL, contrasena: PASSWORD };

describe("GET /api/usuarios (US-02, US-03)", () => {
  it("lists the accounts, oldest first, without their password hashes", async () => {
    await withApp(async (app, db) => {
      const { user: admin, cookie } = await signedIn(db, "ADMINISTRATOR");
      const created = await createOperator(db, {
        name: "Operador de las rutas",
        email: EMAIL,
        password: PASSWORD,
        now: new Date("2030-01-02T15:00:00.000Z"),
        createdBy: { userId: admin.id, ip: IP },
      });
      if (!created.ok) throw new Error("setup failed");
      await db.user.update({
        where: { id: admin.id },
        data: { createdAt: new Date("2030-01-01T15:00:00.000Z") },
      });

      const response = await get(app, cookie);

      expect(response.status).toBe(200);
      const ours = response.body.usuarios.filter((user: { id: number }) =>
        [admin.id, created.userId].includes(user.id),
      );
      expect(ours).toEqual([
        {
          id: admin.id,
          nombre: "Administrador de cuentas",
          correo: "rutas.cuentas@example.com",
          rol: "ADMINISTRADOR",
          activa: true,
          creadaEn: "2030-01-01T15:00:00.000Z",
        },
        {
          id: created.userId,
          nombre: "Operador de las rutas",
          correo: EMAIL,
          rol: "OPERADOR",
          activa: true,
          creadaEn: "2030-01-02T15:00:00.000Z",
        },
      ]);
      expect(JSON.stringify(response.body)).not.toContain("argon2");
    });
  });
});

describe("POST /api/usuarios (US-02, FR-03)", () => {
  it("creates an operator account and logs the administrator and the IP", async () => {
    await withApp(async (app, db) => {
      const { user: admin, cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await post(app, URL, cookie, {
        ...NEW_ACCOUNT,
        correo: "  Operador.Rutas@Example.com ",
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(Number),
        nombre: "Operador de las rutas",
        correo: EMAIL,
        rol: "OPERADOR",
        activa: true,
        creadaEn: expect.any(String),
      });
      const user = await db.user.findUniqueOrThrow({ where: { id: response.body.id } });
      expect(user).toMatchObject({ role: "OPERATOR", mustChangePassword: true });
      const events = await db.auditEvent.findMany({
        where: { action: "ACCOUNT_CREATED", entity: "usuario", entityId: user.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: admin.id, ip: IP, detail: null });
      expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
      // The new operator can sign in with the initial password (FR-01).
      expect(
        (await signIn(db, { email: EMAIL, password: PASSWORD, ip: IP, now: new Date() })).ok,
      ).toBe(true);
    });
  });

  it("answers 409 CORREO_EN_USO for an email already registered, in any case", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");
      await post(app, URL, cookie, NEW_ACCOUNT);

      const response = await post(app, URL, cookie, {
        ...NEW_ACCOUNT,
        nombre: "Otra persona",
        correo: "OPERADOR.rutas@example.com",
      });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: { codigo: "CORREO_EN_USO", mensaje: "Ya existe una cuenta con ese correo." },
      });
      expect(await db.user.count({ where: { email: EMAIL } })).toBe(1);
    });
  });

  it.each([
    ["no name", { correo: EMAIL, contrasena: PASSWORD }],
    ["a name of only spaces", { ...NEW_ACCOUNT, nombre: "   " }],
    ["a name of 101 characters", { ...NEW_ACCOUNT, nombre: "a".repeat(101) }],
    ["an invalid email", { ...NEW_ACCOUNT, correo: "operador.rutas" }],
    ["an email of 255 characters", { ...NEW_ACCOUNT, correo: `${"a".repeat(243)}@example.com` }],
    ["a password of 14 characters", { ...NEW_ACCOUNT, contrasena: "a".repeat(14) }],
    ["a password of 65 characters", { ...NEW_ACCOUNT, contrasena: "a".repeat(65) }],
    ["a password that is not text", { ...NEW_ACCOUNT, contrasena: 123456789012345 }],
    ["a role", { ...NEW_ACCOUNT, rol: "ADMINISTRADOR" }],
  ])("rejects %s with 400 ENTRADA_INVALIDA and creates nothing", async (_case, body) => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");
      const usersBefore = await db.user.count();

      const response = await post(app, URL, cookie, body);

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      expect(await db.user.count()).toBe(usersBefore);
    });
  });

  it("accepts a name of 100 characters and an email of 254", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");
      const correo = `${"a".repeat(242)}@example.com`;

      const response = await post(app, URL, cookie, {
        ...NEW_ACCOUNT,
        nombre: "a".repeat(100),
        correo,
      });

      expect(response.status).toBe(201);
      expect(response.body.correo).toBe(correo);
    });
  });
});

describe("access to /api/usuarios (NFR-05, matrix 1.2)", () => {
  it("GET without a session answers 401", async () => {
    await withApp(async (app) => {
      const response = await get(app);

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });

  it("GET by an operator answers 403 and logs ACCESO_DENEGADO", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(db, "OPERATOR");

      const response = await get(app, cookie);

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ACCESO_DENEGADO");
      const events = await db.auditEvent.findMany({
        where: { action: "ACCESS_DENIED", userId: user.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ detail: { metodo: "GET", ruta: URL }, ip: IP });
    });
  });

  it("a POST without a session answers 401 before the body is validated", async () => {
    await withApp(async (app) => {
      const response = await post(app, URL, undefined, { rol: "ADMINISTRADOR" });

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });

  it("an operator gets 403 before the body is validated, and nothing is created", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(db, "OPERATOR");

      const invalid = await post(app, URL, cookie, { rol: "ADMINISTRADOR" });
      const valid = await post(app, URL, cookie, NEW_ACCOUNT);

      expect([invalid.status, valid.status]).toEqual([403, 403]);
      expect(await db.user.findUnique({ where: { email: EMAIL } })).toBeNull();
      const events = await db.auditEvent.findMany({
        where: { action: "ACCESS_DENIED", userId: user.id },
      });
      expect(events.map((event) => event.detail)).toEqual([
        { metodo: "POST", ruta: URL },
        { metodo: "POST", ruta: URL },
      ]);
    });
  });

  it("a POST without Origin answers 403 ORIGEN_NO_PERMITIDO and creates nothing", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await request(app)
        .post(URL)
        .set("X-Forwarded-For", IP)
        .set("Cookie", cookie)
        .send(NEW_ACCOUNT);

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      expect(await db.user.findUnique({ where: { email: EMAIL } })).toBeNull();
    });
  });
});

// An operator with an open session of its own, as on another computer.
const OPERATOR_TOKEN = "token-de-prueba-del-operador-de-las-cuentas";

async function operatorSignedIn(db: Prisma.TransactionClient, adminId: number) {
  const created = await createOperator(db, {
    name: "Operador de las rutas",
    email: EMAIL,
    password: PASSWORD,
    now: new Date(),
    createdBy: { userId: adminId, ip: IP },
  });
  if (!created.ok) throw new Error("setup failed");
  // As if the operator had already changed the initial password (RI-16).
  await db.user.update({ where: { id: created.userId }, data: { mustChangePassword: false } });
  await db.session.create({
    data: {
      userId: created.userId,
      tokenHash: hashSessionToken(OPERATOR_TOKEN),
      ip: IP,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { id: created.userId, cookie: `sesion=${OPERATOR_TOKEN}` };
}

function stateUrl(id: number | string) {
  return `${URL}/${id}/estado`;
}

// What the operator sees on its next request.
function operatorList(app: Express, cookie: string) {
  return request(app)
    .get("/api/estadias?estado=ACTIVA")
    .set("X-Forwarded-For", IP)
    .set("Cookie", cookie);
}

describe("POST /api/usuarios/{id}/estado (US-03, FR-04)", () => {
  it("deactivates an operator, whose next request answers 401, and logs it (NFR-04)", async () => {
    await withApp(async (app, db) => {
      const { user: admin, cookie } = await signedIn(db, "ADMINISTRATOR");
      const operator = await operatorSignedIn(db, admin.id);
      expect((await operatorList(app, operator.cookie)).status).toBe(200);

      const response = await post(app, stateUrl(operator.id), cookie, { activa: false });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: operator.id, rol: "OPERADOR", activa: false });
      expect((await operatorList(app, operator.cookie)).status).toBe(401);
      const events = await db.auditEvent.findMany({
        where: { action: "ACCOUNT_DEACTIVATED", entity: "usuario", entityId: operator.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: admin.id, ip: IP });
    });
  });

  it("reactivates an operator, who signs in again while the old session stays closed", async () => {
    await withApp(async (app, db) => {
      const { user: admin, cookie } = await signedIn(db, "ADMINISTRATOR");
      const operator = await operatorSignedIn(db, admin.id);
      await post(app, stateUrl(operator.id), cookie, { activa: false });

      const response = await post(app, stateUrl(operator.id), cookie, { activa: true });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: operator.id, activa: true });
      expect((await operatorList(app, operator.cookie)).status).toBe(401);
      expect(
        (await signIn(db, { email: EMAIL, password: PASSWORD, ip: IP, now: new Date() })).ok,
      ).toBe(true);
      const events = await db.auditEvent.count({
        where: { action: "ACCOUNT_REACTIVATED", entity: "usuario", entityId: operator.id },
      });
      expect(events).toBe(1);
    });
  });

  it("keeps the account and what it registered (BR-12)", async () => {
    await withApp(async (app, db) => {
      const { user: admin, cookie } = await signedIn(db, "ADMINISTRATOR");
      const operator = await operatorSignedIn(db, admin.id);
      const sessionsBefore = await db.session.count({ where: { userId: operator.id } });

      const response = await post(app, stateUrl(operator.id), cookie, { activa: false });

      expect(response.status).toBe(200);
      expect(await db.user.findUnique({ where: { id: operator.id } })).not.toBeNull();
      expect(await db.session.count({ where: { userId: operator.id } })).toBe(sessionsBefore);
      expect(
        await db.auditEvent.count({ where: { action: "ACCOUNT_CREATED", entityId: operator.id } }),
      ).toBe(1);
    });
  });

  it.each([
    ["deactivating an account already deactivated", false],
    ["reactivating an account already active", true],
  ])("answers 409 CUENTA_YA_EN_ESE_ESTADO %s", async (_case, activa) => {
    await withApp(async (app, db) => {
      const { user: admin, cookie } = await signedIn(db, "ADMINISTRATOR");
      const operator = await operatorSignedIn(db, admin.id);
      if (!activa) await post(app, stateUrl(operator.id), cookie, { activa: false });

      const response = await post(app, stateUrl(operator.id), cookie, { activa });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: { codigo: "CUENTA_YA_EN_ESE_ESTADO", mensaje: "La cuenta ya estaba en ese estado." },
      });
    });
  });

  it("answers 409 CUENTA_NO_OPERADOR for an administrator account, even its own", async () => {
    await withApp(async (app, db) => {
      const { user: admin, cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await post(app, stateUrl(admin.id), cookie, { activa: false });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          codigo: "CUENTA_NO_OPERADOR",
          mensaje: "Solo las cuentas de operador se desactivan o reactivan.",
        },
      });
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).active).toBe(true);
      expect((await get(app, cookie)).status).toBe(200);
    });
  });

  it("answers 404 NO_ENCONTRADO for an account that does not exist", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await post(app, stateUrl(2_147_483_647), cookie, { activa: false });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: { codigo: "NO_ENCONTRADO", mensaje: "La cuenta no existe." },
      });
    });
  });

  it.each([
    ["the id 0", "0", { activa: false }],
    ["an id with a leading zero", "01", { activa: false }],
    ["an id that is not a number", "abc", { activa: false }],
    ["an id above INTEGER", "2147483648", { activa: false }],
    ["an empty body", "1", {}],
    ["activa as text", "1", { activa: "false" }],
    ["an unknown field", "1", { activa: false, rol: "ADMINISTRADOR" }],
  ])("rejects %s with 400 ENTRADA_INVALIDA", async (_case, id, body) => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await post(app, stateUrl(id), cookie, body);

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
    });
  });

  it("answers 401 without a session, before validating", async () => {
    await withApp(async (app) => {
      const response = await post(app, stateUrl("abc"), undefined, {});

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });

  it("answers 403 to an operator before validating, logs it and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(db, "OPERATOR");
      const other = await db.user.create({
        data: {
          name: "Otro operador",
          email: "otro.rutas@example.com",
          passwordHash: "not-a-real-hash",
          role: "OPERATOR",
          mustChangePassword: false,
        },
      });

      const invalid = await post(app, stateUrl("abc"), cookie, {});
      const valid = await post(app, stateUrl(other.id), cookie, { activa: false });

      expect([invalid.status, valid.status]).toEqual([403, 403]);
      expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).active).toBe(true);
      const events = await db.auditEvent.findMany({
        where: { action: "ACCESS_DENIED", userId: user.id },
      });
      expect(events.map((event) => event.detail)).toEqual([
        { metodo: "POST", ruta: stateUrl("abc") },
        { metodo: "POST", ruta: stateUrl(other.id) },
      ]);
    });
  });

  it("answers 403 ORIGEN_NO_PERMITIDO without Origin and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { user: admin, cookie } = await signedIn(db, "ADMINISTRATOR");
      const operator = await operatorSignedIn(db, admin.id);

      const response = await request(app)
        .post(stateUrl(operator.id))
        .set("X-Forwarded-For", IP)
        .set("Cookie", cookie)
        .send({ activa: false });

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      expect((await db.user.findUniqueOrThrow({ where: { id: operator.id } })).active).toBe(true);
    });
  });
});

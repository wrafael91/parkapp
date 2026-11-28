import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { hashPassword } from "./password.js";
import { hashSessionToken } from "./session-token.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => {
  vi.restoreAllMocks();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const EMAIL = "admin.rutas@example.com";
const PASSWORD = "otra frase de paso bastante larga";
const IP = "198.51.100.7";

// Like the service tests, each test runs as parkapp_app and always rolls back.
// The routes call prisma.$transaction; here it reuses the test transaction.
async function withApp(test: (app: Express, db: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
        const prismaInTest = {
          $transaction: (run: (db: Prisma.TransactionClient) => Promise<unknown>) => run(tx),
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

async function createUser(db: Prisma.TransactionClient) {
  return db.user.create({
    data: {
      name: "Administradora de rutas",
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      role: "ADMINISTRATOR",
    },
  });
}

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function postSession(app: Express, body: object = { correo: EMAIL, contrasena: PASSWORD }) {
  return request(app).post("/api/sesion").set("Origin", ORIGIN).set("X-Forwarded-For", IP).send(body);
}

function sessionCookie(response: request.Response): string {
  const cookies: string[] = response.get("Set-Cookie") ?? [];
  const cookie = cookies.find((value) => value.startsWith("sesion="));
  if (cookie === undefined) throw new Error("no sesion cookie");
  return cookie;
}

function tokenOf(cookie: string): string {
  return cookie.slice("sesion=".length, cookie.indexOf(";"));
}

// Signs in and returns the Cookie header the browser would send back.
async function signedIn(app: Express, db: Prisma.TransactionClient) {
  const user = await createUser(db);
  const response = await postSession(app);
  return { user, cookie: `sesion=${tokenOf(sessionCookie(response))}` };
}

describe("POST /api/sesion (FR-01)", () => {
  it("signs in, answers with the user in Spanish and sets the session cookie", async () => {
    await withApp(async (app, db) => {
      const user = await createUser(db);

      const response = await postSession(app);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        usuario: {
          id: user.id,
          nombre: "Administradora de rutas",
          rol: "ADMINISTRADOR",
          debeCambiarContrasena: true,
        },
      });
      // docs/modelo-amenazas.md, 7.2
      const cookie = sessionCookie(response);
      expect(cookie).toMatch(/^sesion=[\w-]{43};/);
      for (const attribute of ["Max-Age=43200", "Path=/api", "HttpOnly", "Secure", "SameSite=Strict"]) {
        expect(cookie).toContain(`; ${attribute}`);
      }
      expect(cookie).not.toContain("Domain");
    });
  });

  it("stores the client IP that Nginx sends in X-Forwarded-For (A-25)", async () => {
    await withApp(async (app, db) => {
      await createUser(db);

      const response = await postSession(app);

      const session = await db.session.findUniqueOrThrow({
        where: { tokenHash: hashSessionToken(tokenOf(sessionCookie(response))) },
      });
      expect(session.ip).toBe(IP);
    });
  });

  it.each([
    ["a wrong password", EMAIL, `${PASSWORD}!`],
    ["an unknown email", "nadie@example.com", PASSWORD],
  ])("answers %s with 401 NO_AUTENTICADO and no cookie", async (_case, correo, contrasena) => {
    await withApp(async (app, db) => {
      await createUser(db);

      const response = await postSession(app, { correo, contrasena });

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
      expect(response.get("Set-Cookie")).toBeUndefined();
    });
  });

  it.each([
    ["no password", { correo: EMAIL }],
    ["an email that is not text", { correo: 123, contrasena: PASSWORD }],
    ["an empty email", { correo: "", contrasena: PASSWORD }],
    ["a password over 64 characters", { correo: EMAIL, contrasena: "a".repeat(65) }],
  ])("rejects a body with %s with 400 ENTRADA_INVALIDA (NFR-06)", async (_case, body) => {
    await withApp(async (app, db) => {
      await createUser(db);

      const response = await postSession(app, body);

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      expect(await db.auditEvent.count({ where: { ip: IP } })).toBe(0);
    });
  });

  it("rejects a sign-in without Origin before touching the database (section 7.4)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await withApp(async (app, db) => {
      const user = await createUser(db);

      const response = await request(app)
        .post("/api/sesion")
        .set("X-Forwarded-For", IP)
        .send({ correo: EMAIL, contrasena: PASSWORD });

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await db.auditEvent.count({ where: { ip: IP } })).toBe(0);
    });
  });
});

describe("GET /api/sesion", () => {
  it("answers with the user of the active session", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(app, db);

      const response = await request(app).get("/api/sesion").set("Cookie", cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        usuario: {
          id: user.id,
          nombre: "Administradora de rutas",
          rol: "ADMINISTRADOR",
          debeCambiarContrasena: true,
        },
      });
    });
  });

  it.each([
    ["no cookie", undefined],
    ["an unknown token", "sesion=token-inventado"],
  ])("answers a request with %s with 401 NO_AUTENTICADO", async (_case, cookie) => {
    await withApp(async (app, db) => {
      await signedIn(app, db);

      const req = request(app).get("/api/sesion");
      const response = await (cookie === undefined ? req : req.set("Cookie", cookie));

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });
});

describe("DELETE /api/sesion (FR-02)", () => {
  it("revokes the session and clears the cookie, so the old cookie gets 401", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(app, db);

      const response = await request(app)
        .delete("/api/sesion")
        .set("Origin", ORIGIN)
        .set("Cookie", cookie);

      expect(response.status).toBe(204);
      const cleared = sessionCookie(response);
      expect(cleared).toMatch(/^sesion=;/);
      for (const attribute of [
        "Path=/api",
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
      ]) {
        expect(cleared).toContain(`; ${attribute}`);
      }
      // US-01: reusing the session after signing out gets 401.
      const after = await request(app).get("/api/sesion").set("Cookie", cookie);
      expect(after.status).toBe(401);
    });
  });

  it("answers 204 without a session cookie", async () => {
    await withApp(async (app) => {
      const response = await request(app).delete("/api/sesion").set("Origin", ORIGIN);

      expect(response.status).toBe(204);
    });
  });

  it("rejects a sign-out from another site and keeps the session (section 7.4)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(app, db);

      const response = await request(app)
        .delete("/api/sesion")
        .set("Origin", "https://ejemplo.net")
        .set("Cookie", cookie);

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      const after = await request(app).get("/api/sesion").set("Cookie", cookie);
      expect(after.status).toBe(200);
    });
  });
});

const NEW_PASSWORD = "una frase nueva que nadie mas conoce";

function postPassword(
  app: Express,
  cookie: string | undefined,
  body: object = { actual: PASSWORD, nueva: NEW_PASSWORD },
) {
  const req = request(app)
    .post("/api/sesion/contrasena")
    .set("Origin", ORIGIN)
    .set("X-Forwarded-For", IP);
  return (cookie === undefined ? req : req.set("Cookie", cookie)).send(body);
}

describe("POST /api/sesion/contrasena (US-05, FR-06)", () => {
  it("changes the password, answers with the user and keeps this session open", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(app, db);

      const response = await postPassword(app, cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        usuario: {
          id: user.id,
          nombre: "Administradora de rutas",
          rol: "ADMINISTRADOR",
          debeCambiarContrasena: false,
        },
      });
      const after = await request(app).get("/api/sesion").set("Cookie", cookie);
      expect(after.status).toBe(200);
      expect(after.body.usuario.debeCambiarContrasena).toBe(false);
      // FR-01: the new password signs in, and the old one does not.
      const withNew = await postSession(app, { correo: EMAIL, contrasena: NEW_PASSWORD });
      expect(withNew.status).toBe(200);
      expect((await postSession(app)).status).toBe(401);
    });
  });

  it("closes the other sessions of the account (NFR-04)", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(app, db);
      const other = `sesion=${tokenOf(sessionCookie(await postSession(app)))}`;

      await postPassword(app, cookie);

      const response = await request(app).get("/api/sesion").set("Cookie", other);
      expect(response.status).toBe(401);
    });
  });

  it("records CONTRASENA_CAMBIADA with the user and the IP that Nginx sends", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(app, db);

      await postPassword(app, cookie);

      const events = await db.auditEvent.findMany({
        where: { action: "PASSWORD_CHANGED", entity: "usuario", entityId: user.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: user.id, ip: IP, detail: null });
    });
  });

  it.each([
    ["no cookie", undefined],
    ["an unknown token", "sesion=token-inventado"],
  ])("answers a request with %s with 401 before the body is validated", async (_case, cookie) => {
    await withApp(async (app, db) => {
      await signedIn(app, db);

      const response = await postPassword(app, cookie, {});

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });

  it.each([
    ["a wrong current password", { actual: `${PASSWORD}!` }, "CONTRASENA_ACTUAL_INCORRECTA"],
    // RI-16: whoever assigned it would still know it.
    ["the current password as the new one", { nueva: PASSWORD }, "CONTRASENA_REPETIDA"],
    ["a new password of 14 characters", { nueva: "a".repeat(14) }, "ENTRADA_INVALIDA"],
    ["a new password of 65 characters", { nueva: "a".repeat(65) }, "ENTRADA_INVALIDA"],
    ["no new password", { nueva: undefined }, "ENTRADA_INVALIDA"],
    ["a new password that is not text", { nueva: 123 }, "ENTRADA_INVALIDA"],
    ["an empty current password", { actual: "" }, "ENTRADA_INVALIDA"],
    ["a current password over 64 characters", { actual: "a".repeat(65) }, "ENTRADA_INVALIDA"],
    ["an unknown field", { correo: EMAIL }, "ENTRADA_INVALIDA"],
  ])("rejects %s with 400 and changes nothing", async (_case, change, codigo) => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(app, db);

      const response = await postPassword(app, cookie, {
        actual: PASSWORD,
        nueva: NEW_PASSWORD,
        ...change,
      });

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe(codigo);
      expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
      expect(await db.auditEvent.count({ where: { action: "PASSWORD_CHANGED" } })).toBe(0);
      // Not 401: the session is still valid.
      const after = await request(app).get("/api/sesion").set("Cookie", cookie);
      expect(after.status).toBe(200);
    });
  });

  it("rejects a change without Origin and changes nothing (section 7.4)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(app, db);

      const response = await request(app)
        .post("/api/sesion/contrasena")
        .set("Cookie", cookie)
        .send({ actual: PASSWORD, nueva: NEW_PASSWORD });

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
    });
  });
});

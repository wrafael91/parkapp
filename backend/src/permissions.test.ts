import { afterAll, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { createPrismaClient } from "./db.js";

const prisma = createPrismaClient(config.databaseUrl);

class Rollback extends Error {}

// Runs one statement as parkapp_app and always rolls back.
async function runAsApp(sql: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
      await tx.$executeRawUnsafe(sql);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("parkapp_app privileges (NFR-12)", () => {
  it("can read and insert in the audit log", async () => {
    await expect(runAsApp("SELECT * FROM evento_auditoria")).resolves.toBeUndefined();
    await expect(
      runAsApp("INSERT INTO evento_auditoria (accion) VALUES ('INICIO_SESION_FALLIDO')"),
    ).resolves.toBeUndefined();
  });

  it("cannot update or delete the audit log", async () => {
    await expect(runAsApp("UPDATE evento_auditoria SET ip = 'x'")).rejects.toThrow(/permission denied/);
    await expect(runAsApp("DELETE FROM evento_auditoria")).rejects.toThrow(/permission denied/);
  });

  it("can read the legal cap but not change it (BR-15)", async () => {
    await expect(runAsApp("SELECT * FROM tope_legal")).resolves.toBeUndefined();
    await expect(runAsApp("UPDATE tope_legal SET valor_minuto = 1")).rejects.toThrow(/permission denied/);
    await expect(
      runAsApp(
        "INSERT INTO tope_legal (tipo_vehiculo, valor_minuto, con_sello_oro, norma, vigente_desde) VALUES ('CARRO', 1, false, 'x', now())",
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("can update a stay's exit data but not its entry data (BR-17)", async () => {
    await expect(runAsApp("UPDATE estadia SET estado = 'CERRADA'")).resolves.toBeUndefined();
    await expect(runAsApp("UPDATE estadia SET placa = 'XXX000'")).rejects.toThrow(/permission denied/);
  });

  it("cannot create objects in the schema", async () => {
    await expect(runAsApp("CREATE TABLE intrusion (id int)")).rejects.toThrow(/permission denied/);
  });
});

describe("privilege guard", () => {
  it("every model table grants SELECT to parkapp_app", async () => {
        const tablesWithoutPrivileges = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
            AND tablename <> '_prisma_migrations'
            AND NOT has_table_privilege('parkapp_app', format('%I.%I', schemaname, tablename), 'SELECT')
    `;
    expect(tablesWithoutPrivileges).toEqual([]);
  });

  it("_prisma_migrations grants nothing to parkapp_app", async () => {
    const [row] = await prisma.$queryRaw<{ has_any: boolean }[]>`
      SELECT has_table_privilege(
        'parkapp_app', 'public._prisma_migrations',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
      ) AS has_any
    `;
    expect(row?.has_any).toBe(false);
  });
});

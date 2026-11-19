import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { createPrismaClient } from "./db.js";
import type { Prisma } from "./generated/prisma/client.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

type Tx = Prisma.TransactionClient;

interface Fixture {
  userId: number;
  rateId: number;
  gracePeriodId: number;
}

class Rollback extends Error {}

// Runs a scenario on top of a fresh fixture and always rolls back. By default it
// runs as parkapp_app; the legal cap, which the app cannot write, runs as the owner.
async function scenario(
  run: (tx: Tx, fixture: Fixture) => Promise<unknown>,
  role: "app" | "owner" = "app",
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      if (role === "app") await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
      await run(tx, await createFixture(tx));
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

// The fixture's rate and grace period are closed versions from January 1, 2026, so
// they never collide with the current versions of a development database.
async function createFixture(tx: Tx): Promise<Fixture> {
  const [user] = await tx.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO usuario (nombre, correo, hash_contrasena, rol)
     VALUES ('Integridad', $1, 'x', 'ADMINISTRADOR') RETURNING id`,
    `integridad-${randomUUID()}@prueba.local`,
  );
  const [rate] = await tx.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO tarifa (tipo_vehiculo, valor_minuto, tope_legal_id, vigente_desde, vigente_hasta, creada_por_id)
     SELECT 'CARRO', 230, id, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', $1
     FROM tope_legal WHERE tipo_vehiculo = 'CARRO' ORDER BY id LIMIT 1 RETURNING id`,
    user!.id,
  );
  const [gracePeriod] = await tx.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO periodo_gracia (minutos, vigente_desde, vigente_hasta, creado_por_id)
     VALUES (5, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', $1) RETURNING id`,
    user!.id,
  );
  return { userId: user!.id, rateId: rate!.id, gracePeriodId: gracePeriod!.id };
}

interface StayValues {
  id?: number;
  plate?: string;
  vehicleType?: "CARRO" | "MOTO";
  status?: "ACTIVA" | "CERRADA" | "ANULADA";
  exitTime?: string | null;
  withExitUser?: boolean;
  voidedAt?: string | null;
  withVoidUser?: boolean;
  voidReason?: string | null;
  replacesId?: number | null;
  periodCapId?: number | null;
}

// Inserts a stay that enters at 10:00 on January 1, 2026, and returns its id.
async function insertStay(tx: Tx, f: Fixture, values: StayValues = {}): Promise<number> {
  const v = {
    plate: "ABC123",
    vehicleType: "CARRO",
    status: "ACTIVA",
    exitTime: null,
    withExitUser: false,
    voidedAt: null,
    withVoidUser: false,
    voidReason: null,
    replacesId: null,
    periodCapId: null,
    ...values,
  };
  const [stay] = await tx.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO estadia (id, placa, tipo_vehiculo, color, estado, hora_ingreso, ingreso_por_id,
       tarifa_id, periodo_gracia_id, hora_salida, salida_por_id, anulada_en, anulada_por_id,
       motivo_anulacion, reemplaza_a_id, tope_periodo_id)
     VALUES (COALESCE($1, nextval('estadia_id_seq')), $2, $3::tipo_vehiculo, 'Gris',
       $4::estado_estadia, '2026-01-01T10:00:00Z', $5, $6, $7, $8::timestamptz, $9, $10::timestamptz,
       $11, $12, $13, $14)
     RETURNING id`,
    v.id ?? null,
    v.plate,
    v.vehicleType,
    v.status,
    f.userId,
    f.rateId,
    f.gracePeriodId,
    v.exitTime,
    v.withExitUser ? f.userId : null,
    v.voidedAt,
    v.withVoidUser ? f.userId : null,
    v.voidReason,
    v.replacesId,
    v.periodCapId,
  );
  return stay!.id;
}

const EXIT = "2026-01-01T10:37:50Z";
const CLOSED: StayValues = { status: "CERRADA", exitTime: EXIT, withExitUser: true };
const VOIDED: StayValues = {
  status: "ANULADA",
  voidedAt: "2026-01-01T10:05:00Z",
  withVoidUser: true,
  voidReason: "Placa equivocada",
};

describe("stay constraints", () => {
  it("accepts an active, a closed and a voided stay, and an exit at the entry instant", async () => {
    await expect(
      scenario(async (tx, f) => {
        await insertStay(tx, f);
        await insertStay(tx, f, { ...CLOSED, plate: "ABC124" });
        await insertStay(tx, f, { ...CLOSED, plate: "ABC126", exitTime: "2026-01-01T10:00:00Z" });
        await insertStay(tx, f, { ...VOIDED, plate: "ABC12D", vehicleType: "MOTO" });
        await insertStay(tx, f, {
          ...CLOSED,
          ...VOIDED,
          exitTime: EXIT,
          withExitUser: true,
          voidedAt: "2026-01-01T11:00:00Z",
          plate: "ABC125",
        });
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a plate that does not match its vehicle type (RI-01)", async () => {
    for (const [plate, vehicleType] of [
      ["abc123", "CARRO"],
      ["ABC-123", "CARRO"],
      ["ABC12D", "CARRO"],
      ["ABC123", "MOTO"],
    ] as const) {
      await expect(scenario((tx, f) => insertStay(tx, f, { plate, vehicleType }))).rejects.toThrow(
        /estadia_placa_formato/,
      );
    }
  });

  it("rejects a second active stay with the same plate (RI-02)", async () => {
    await expect(
      scenario(async (tx, f) => {
        await insertStay(tx, f);
        await insertStay(tx, f);
      }),
    ).rejects.toThrow(/estadia_placa_activa_unica/);
  });

  it("accepts a new active stay for a plate whose previous stay is closed (RI-02)", async () => {
    await expect(
      scenario(async (tx, f) => {
        await insertStay(tx, f, CLOSED);
        await insertStay(tx, f);
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a stay whose status does not match its data (RI-03)", async () => {
    for (const values of [
      { exitTime: EXIT, withExitUser: true },
      { status: "CERRADA", exitTime: EXIT },
      { status: "CERRADA", withExitUser: true },
      { ...CLOSED, voidedAt: EXIT },
      { ...VOIDED, voidReason: null },
      { ...VOIDED, voidReason: "   " },
      { ...VOIDED, withVoidUser: false },
    ] satisfies StayValues[]) {
      await expect(scenario((tx, f) => insertStay(tx, f, values))).rejects.toThrow(
        /estadia_estado_coherente/,
      );
    }
  });

  it("rejects an exit before the entry (RI-05)", async () => {
    await expect(
      scenario((tx, f) => insertStay(tx, f, { ...CLOSED, exitTime: "2026-01-01T09:59:59Z" })),
    ).rejects.toThrow(/estadia_salida_posterior_ingreso/);
  });

  it("rejects a stay that replaces itself (RI-19)", async () => {
    await expect(
      scenario((tx, f) => insertStay(tx, f, { id: 2_000_000_000, replacesId: 2_000_000_000 })),
    ).rejects.toThrow(/estadia_reemplazo_distinto/);
  });
});

describe("version constraints", () => {
  it("accepts one current rate per vehicle type and one current grace period", async () => {
    await expect(
      scenario(async (tx, f) => {
        await tx.$executeRawUnsafe(
          "UPDATE tarifa SET vigente_hasta = now() WHERE vigente_hasta IS NULL",
        );
        await tx.$executeRawUnsafe(
          "UPDATE periodo_gracia SET vigente_hasta = now() WHERE vigente_hasta IS NULL",
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO tarifa (tipo_vehiculo, valor_minuto, tope_legal_id, creada_por_id)
           SELECT 'CARRO', 200, tope_legal_id, $1 FROM tarifa WHERE id = $2`,
          f.userId,
          f.rateId,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO tarifa (tipo_vehiculo, valor_minuto, tope_legal_id, creada_por_id)
           SELECT 'MOTO', 161, id, $1 FROM tope_legal WHERE tipo_vehiculo = 'MOTO' ORDER BY id LIMIT 1`,
          f.userId,
        );
        await tx.$executeRawUnsafe(
          "INSERT INTO periodo_gracia (minutos, creado_por_id) VALUES (0, $1)",
          f.userId,
        );
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a version that ends before it starts (RI-07)", async () => {
    await expect(
      scenario((tx, f) =>
        tx.$executeRawUnsafe(
          "UPDATE tarifa SET vigente_hasta = vigente_desde WHERE id = $1",
          f.rateId,
        ),
      ),
    ).rejects.toThrow(/tarifa_vigencia_valida/);
    await expect(
      scenario((tx, f) =>
        tx.$executeRawUnsafe(
          "UPDATE periodo_gracia SET vigente_hasta = '2025-12-31T00:00:00Z' WHERE id = $1",
          f.gracePeriodId,
        ),
      ),
    ).rejects.toThrow(/periodo_gracia_vigencia_valida/);
    await expect(
      scenario(
        (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO tope_legal (tipo_vehiculo, valor_minuto, con_sello_oro, norma, vigente_desde, vigente_hasta)
             VALUES ('CARRO', 230, false, 'Prueba', '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')`,
          ),
        "owner",
      ),
    ).rejects.toThrow(/tope_legal_vigencia_valida/);
  });

  it("rejects a second current rate for the same vehicle type (RI-07)", async () => {
    await expect(
      scenario(async (tx, f) => {
        for (let i = 0; i < 2; i++) {
          await tx.$executeRawUnsafe(
            `INSERT INTO tarifa (tipo_vehiculo, valor_minuto, tope_legal_id, creada_por_id)
             SELECT 'CARRO', 200, tope_legal_id, $1 FROM tarifa WHERE id = $2`,
            f.userId,
            f.rateId,
          );
        }
      }),
    ).rejects.toThrow(/tarifa_vigente_unica/);
  });

  it("rejects a second current grace period (RI-07)", async () => {
    await expect(
      scenario(async (tx, f) => {
        for (let i = 0; i < 2; i++) {
          await tx.$executeRawUnsafe(
            "INSERT INTO periodo_gracia (minutos, creado_por_id) VALUES (5, $1)",
            f.userId,
          );
        }
      }),
    ).rejects.toThrow(/periodo_gracia_vigente_unico/);
  });

  it("rejects a second current legal cap for the same vehicle type (RI-07)", async () => {
    await expect(
      scenario(async (tx) => {
        for (let i = 0; i < 2; i++) {
          await tx.$executeRawUnsafe(
            `INSERT INTO tope_legal (tipo_vehiculo, valor_minuto, con_sello_oro, norma, vigente_desde)
             VALUES ('MOTO', 161, false, 'Prueba', '2026-01-01T00:00:00Z')`,
          );
        }
      }, "owner"),
    ).rejects.toThrow(/tope_legal_vigente_unico/);
  });

  it("rejects a rate or a legal cap of zero or less (RI-09)", async () => {
    for (const value of [0, -230]) {
      await expect(
        scenario((tx, f) =>
          tx.$executeRawUnsafe(
            `INSERT INTO tarifa (tipo_vehiculo, valor_minuto, tope_legal_id, vigente_desde, vigente_hasta, creada_por_id)
             SELECT 'CARRO', $1, tope_legal_id, vigente_desde, vigente_hasta, creada_por_id FROM tarifa WHERE id = $2`,
            value,
            f.rateId,
          ),
        ),
      ).rejects.toThrow(/tarifa_valor_positivo/);
      await expect(
        scenario(
          (tx) =>
            tx.$executeRawUnsafe(
              `INSERT INTO tope_legal (tipo_vehiculo, valor_minuto, con_sello_oro, norma, vigente_desde, vigente_hasta)
               VALUES ('CARRO', $1, false, 'Prueba', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z')`,
              value,
            ),
          "owner",
        ),
      ).rejects.toThrow(/tope_legal_valor_positivo/);
    }
  });

  it("rejects a negative grace period (RI-10)", async () => {
    await expect(
      scenario((tx, f) =>
        tx.$executeRawUnsafe(
          `INSERT INTO periodo_gracia (minutos, vigente_desde, vigente_hasta, creado_por_id)
           VALUES (-1, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', $1)`,
          f.userId,
        ),
      ),
    ).rejects.toThrow(/periodo_gracia_minutos_no_negativos/);
  });
});

interface PeriodCapValues {
  hours?: number;
  value?: number;
  validFrom?: string;
  validTo?: string | null;
}

// Inserts a cap version, closed by default like the fixture's rate, and returns its id.
async function insertPeriodCap(tx: Tx, f: Fixture, values: PeriodCapValues = {}): Promise<number> {
  const v = {
    hours: 12,
    value: 11000,
    validFrom: "2026-01-01T00:00:00Z",
    validTo: "2026-01-02T00:00:00Z",
    ...values,
  };
  const [periodCap] = await tx.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO tope_periodo (horas, valor, vigente_desde, vigente_hasta, creado_por_id)
     VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5) RETURNING id`,
    v.hours,
    v.value,
    v.validFrom,
    v.validTo,
    f.userId,
  );
  return periodCap!.id;
}

describe("period cap constraints", () => {
  it("accepts caps of 1 and 24 hours, one current cap and a stay that keeps a cap", async () => {
    await expect(
      scenario(async (tx, f) => {
        await insertPeriodCap(tx, f, { hours: 1, value: 1000 });
        const periodCapId = await insertPeriodCap(tx, f, { hours: 24 });
        await tx.$executeRawUnsafe(
          "UPDATE tope_periodo SET vigente_hasta = now() WHERE vigente_hasta IS NULL",
        );
        await insertPeriodCap(tx, f, { validFrom: "2026-01-02T00:00:00Z", validTo: null });
        await insertStay(tx, f, { periodCapId });
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a stay whose cap does not exist", async () => {
    await expect(
      scenario((tx, f) => insertStay(tx, f, { periodCapId: 2_000_000_000 })),
    ).rejects.toThrow(/estadia_tope_periodo_id_fkey/);
  });

  it("rejects a period outside 1 to 24 hours (RI-20)", async () => {
    for (const hours of [0, 25, -12]) {
      await expect(scenario((tx, f) => insertPeriodCap(tx, f, { hours }))).rejects.toThrow(
        /tope_periodo_horas_validas/,
      );
    }
  });

  it("rejects a cap value of zero or less (RI-20)", async () => {
    for (const value of [0, -11000]) {
      await expect(scenario((tx, f) => insertPeriodCap(tx, f, { value }))).rejects.toThrow(
        /tope_periodo_valor_positivo/,
      );
    }
  });

  it("rejects a cap version that does not end after it starts (RI-07)", async () => {
    for (const validTo of ["2025-12-31T00:00:00Z", "2026-01-01T00:00:00Z"]) {
      await expect(scenario((tx, f) => insertPeriodCap(tx, f, { validTo }))).rejects.toThrow(
        /tope_periodo_vigencia_valida/,
      );
    }
  });

  it("rejects a second current cap (RI-07)", async () => {
    await expect(
      scenario(async (tx, f) => {
        for (let i = 0; i < 2; i++) {
          await insertPeriodCap(tx, f, { validTo: null });
        }
      }),
    ).rejects.toThrow(/tope_periodo_vigente_unico/);
  });
});

interface CapacityValues {
  vehicleType?: "CARRO" | "MOTO";
  spaces?: number;
  validFrom?: string;
  validTo?: string | null;
}

// Inserts a spaces version, closed by default so it never collides with the current
// spaces of a development database.
async function insertCapacity(tx: Tx, f: Fixture, values: CapacityValues = {}): Promise<number> {
  const v = {
    vehicleType: "CARRO",
    spaces: 30,
    validFrom: "2026-01-01T00:00:00Z",
    validTo: "2026-01-02T00:00:00Z",
    ...values,
  };
  const [capacity] = await tx.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO cupo (tipo_vehiculo, cupos, vigente_desde, vigente_hasta, creado_por_id)
     VALUES ($1::tipo_vehiculo, $2, $3::timestamptz, $4::timestamptz, $5) RETURNING id`,
    v.vehicleType,
    v.spaces,
    v.validFrom,
    v.validTo,
    f.userId,
  );
  return capacity!.id;
}

describe("capacity constraints", () => {
  it("accepts 0 and 10,000 spaces and one current version per vehicle type", async () => {
    await expect(
      scenario(async (tx, f) => {
        await insertCapacity(tx, f, { spaces: 0 });
        await insertCapacity(tx, f, { spaces: 10000 });
        await tx.$executeRawUnsafe(
          "UPDATE cupo SET vigente_hasta = now() WHERE vigente_hasta IS NULL",
        );
        await insertCapacity(tx, f, { validFrom: "2026-01-02T00:00:00Z", validTo: null });
        await insertCapacity(tx, f, {
          vehicleType: "MOTO",
          validFrom: "2026-01-02T00:00:00Z",
          validTo: null,
        });
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects spaces below 0 or above 10,000 (RI-21)", async () => {
    for (const spaces of [-1, 10001]) {
      await expect(scenario((tx, f) => insertCapacity(tx, f, { spaces }))).rejects.toThrow(
        /cupo_cupos_validos/,
      );
    }
  });

  it("rejects a spaces version that does not end after it starts (RI-07)", async () => {
    for (const validTo of ["2025-12-31T00:00:00Z", "2026-01-01T00:00:00Z"]) {
      await expect(scenario((tx, f) => insertCapacity(tx, f, { validTo }))).rejects.toThrow(
        /cupo_vigencia_valida/,
      );
    }
  });

  it("rejects a second current version for the same vehicle type (RI-07)", async () => {
    await expect(
      scenario(async (tx, f) => {
        for (let i = 0; i < 2; i++) {
          await insertCapacity(tx, f, { vehicleType: "MOTO", validTo: null });
        }
      }),
    ).rejects.toThrow(/cupo_vigente_unico/);
  });
});

interface ReceiptValues {
  fullMinutes: number;
  subtotal: number;
  capDiscount?: number;
  roundingAdjustment: number;
  total: number;
}

async function insertReceipt(tx: Tx, f: Fixture, values: ReceiptValues): Promise<void> {
  const stayId = await insertStay(tx, f, CLOSED);
  await tx.$executeRawUnsafe(
    `INSERT INTO comprobante (estadia_id, minutos_completos, subtotal, descuento_tope, ajuste_redondeo, total)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    stayId,
    values.fullMinutes,
    values.subtotal,
    values.capDiscount ?? 0,
    values.roundingAdjustment,
    values.total,
  );
}

async function insertAuditEvent(
  tx: Tx,
  f: Fixture,
  values: { withUser: boolean; ip: string | null; entity: string | null; entityId: number | null },
): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO evento_auditoria (accion, usuario_id, entidad, entidad_id, ip)
     VALUES ('INGRESO_REGISTRADO', $1, $2, $3, $4)`,
    values.withUser ? f.userId : null,
    values.entity,
    values.entityId,
    values.ip,
  );
}

describe("receipt, audit and account constraints", () => {
  it("accepts a charged receipt and a receipt of $0 within the grace period", async () => {
    await expect(
      scenario(async (tx, f) => {
        await insertReceipt(tx, f, {
          fullMinutes: 37,
          subtotal: 8510,
          roundingAdjustment: 10,
          total: 8500,
        });
        await insertReceipt(tx, f, {
          fullMinutes: 3,
          subtotal: 0,
          roundingAdjustment: 0,
          total: 0,
        });
      }),
    ).resolves.toBeUndefined();
  });

  // Examples 9 and 12 of docs/reglas-de-negocio.md ($33 per minute, $11,000 every 12 hours).
  it("accepts receipts with a cap discount (BR-18)", async () => {
    await expect(
      scenario(async (tx, f) => {
        await insertReceipt(tx, f, {
          fullMinutes: 334,
          subtotal: 11022,
          capDiscount: 22,
          roundingAdjustment: 0,
          total: 11000,
        });
        await insertReceipt(tx, f, {
          fullMinutes: 900,
          subtotal: 29700,
          capDiscount: 12760,
          roundingAdjustment: 40,
          total: 16900,
        });
      }),
    ).resolves.toBeUndefined();
  });

  // While a deploy applies the migration, the previous version of the API still
  // issues receipts without this column (ParkApp-Deploy): they get a discount of $0.
  it("gives a receipt issued without the cap discount a discount of $0", async () => {
    await expect(
      scenario(async (tx, f) => {
        const stayId = await insertStay(tx, f, CLOSED);
        const [receipt] = await tx.$queryRawUnsafe<{ descuento_tope: number }[]>(
          `INSERT INTO comprobante (estadia_id, minutos_completos, subtotal, ajuste_redondeo, total)
           VALUES ($1, 6, 1380, 30, 1350) RETURNING descuento_tope`,
          stayId,
        );
        expect(receipt!.descuento_tope).toBe(0);
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a receipt whose amounts do not add up (RI-12)", async () => {
    for (const values of [
      { fullMinutes: 37, subtotal: 8510, roundingAdjustment: 10, total: 8550 },
      { fullMinutes: 37, subtotal: 8510, roundingAdjustment: 60, total: 8450 },
      { fullMinutes: 6, subtotal: 1400, roundingAdjustment: 50, total: 1350 },
      { fullMinutes: 37, subtotal: 8510, roundingAdjustment: 0, total: 8510 },
      { fullMinutes: 6, subtotal: 1380, roundingAdjustment: -20, total: 1400 },
      { fullMinutes: -1, subtotal: 0, roundingAdjustment: 0, total: 0 },
      { fullMinutes: 1, subtotal: -50, roundingAdjustment: 0, total: -50 },
      {
        fullMinutes: 900,
        subtotal: 29700,
        capDiscount: 12760,
        roundingAdjustment: 0,
        total: 29700,
      },
      { fullMinutes: 10, subtotal: 330, capDiscount: 380, roundingAdjustment: 0, total: -50 },
      { fullMinutes: 10, subtotal: 330, capDiscount: -20, roundingAdjustment: 0, total: 350 },
    ]) {
      await expect(scenario((tx, f) => insertReceipt(tx, f, values))).rejects.toThrow(
        /comprobante_valores_validos/,
      );
    }
  });

  it("accepts audit events with and without a user, entity and IP", async () => {
    await expect(
      scenario(async (tx, f) => {
        await insertAuditEvent(tx, f, {
          withUser: true,
          ip: "203.0.113.7",
          entity: "estadia",
          entityId: 1,
        });
        await insertAuditEvent(tx, f, { withUser: false, ip: null, entity: null, entityId: null });
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects an audit entity without its id, or an id without its entity (RI-17)", async () => {
    for (const [entity, entityId] of [
      ["estadia", null],
      [null, 1],
    ] as const) {
      await expect(
        scenario((tx, f) =>
          insertAuditEvent(tx, f, { withUser: false, ip: null, entity, entityId }),
        ),
      ).rejects.toThrow(/evento_auditoria_entidad_completa/);
    }
  });

  it("rejects an audit event with a user and no IP (RI-18)", async () => {
    await expect(
      scenario((tx, f) =>
        insertAuditEvent(tx, f, { withUser: true, ip: null, entity: null, entityId: null }),
      ),
    ).rejects.toThrow(/evento_auditoria_ip_con_usuario/);
  });

  it("rejects an email that differs from another only in case (RI-15)", async () => {
    await expect(
      scenario(async (tx) => {
        const email = `caso-${randomUUID()}@prueba.local`;
        for (const value of [email, email.toUpperCase()]) {
          await tx.$executeRawUnsafe(
            `INSERT INTO usuario (nombre, correo, hash_contrasena, rol)
             VALUES ('Caso', $1, 'x', 'OPERADOR')`,
            value,
          );
        }
      }),
    ).rejects.toThrow(/usuario_correo_sin_mayusculas_unico/);
  });
});

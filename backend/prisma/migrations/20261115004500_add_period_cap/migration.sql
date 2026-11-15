-- Fee cap per period (BR-18, S3-04, #14): a general cap, the same for cars and
-- motorcycles, versioned like the rate and the grace period (BR-11). Compatible with
-- the previous version of the API, which runs until the deploy switches versions:
-- the new stay column is nullable and the new receipt column defaults to 0.

-- AddEnumValue: the administrator turns the cap on, changes it or turns it off.
ALTER TYPE "accion_auditoria" ADD VALUE 'TOPE_PERIODO_CAMBIADO';

-- CreateTable
CREATE TABLE "tope_periodo" (
    "id" SERIAL NOT NULL,
    "horas" INTEGER NOT NULL,
    "valor" INTEGER NOT NULL,
    "vigente_desde" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_hasta" TIMESTAMPTZ(3),
    "creado_por_id" INTEGER NOT NULL,

    CONSTRAINT "tope_periodo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tope_periodo_creado_por_id_idx" ON "tope_periodo"("creado_por_id");

-- AddForeignKey
ALTER TABLE "tope_periodo" ADD CONSTRAINT "tope_periodo_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: null when no cap was in force at entry (BR-11). Turning the cap off
-- closes the current version and creates none.
ALTER TABLE "estadia" ADD COLUMN "tope_periodo_id" INTEGER;

-- CreateIndex
CREATE INDEX "estadia_tope_periodo_id_idx" ON "estadia"("tope_periodo_id");

-- AddForeignKey
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_tope_periodo_id_fkey" FOREIGN KEY ("tope_periodo_id") REFERENCES "tope_periodo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: what the cap took off the subtotal; 0 in every receipt issued so far.
ALTER TABLE "comprobante" ADD COLUMN "descuento_tope" INTEGER NOT NULL DEFAULT 0;

-- Integrity rules (docs/modelo-datos.md, section 3.2). Every CHECK evaluates to true
-- or false, never NULL, as in S3-03.

-- RI-20: the period is 1 to 24 whole hours and the value is greater than zero.
ALTER TABLE "tope_periodo" ADD CONSTRAINT "tope_periodo_horas_validas" CHECK (
  "horas" BETWEEN 1 AND 24
);
ALTER TABLE "tope_periodo" ADD CONSTRAINT "tope_periodo_valor_positivo" CHECK ("valor" > 0);

-- RI-07: every version ends after it starts, and there is at most one current cap.
ALTER TABLE "tope_periodo" ADD CONSTRAINT "tope_periodo_vigencia_valida" CHECK (
  "vigente_hasta" IS NULL OR "vigente_hasta" > "vigente_desde"
);
CREATE UNIQUE INDEX "tope_periodo_vigente_unico" ON "tope_periodo" (("vigente_hasta" IS NULL))
  WHERE "vigente_hasta" IS NULL;

-- RI-12, rebuilt with the cap discount: the subtotal stays minutes x rate, the
-- discount is $0 to the subtotal, and the total is the subtotal minus the discount
-- and the rounding adjustment. Existing receipts pass: their discount is 0.
ALTER TABLE "comprobante" DROP CONSTRAINT "comprobante_valores_validos";
ALTER TABLE "comprobante" ADD CONSTRAINT "comprobante_valores_validos" CHECK (
  "minutos_completos" >= 0
  AND "subtotal" >= 0
  AND "descuento_tope" BETWEEN 0 AND "subtotal"
  AND "ajuste_redondeo" BETWEEN 0 AND 49
  AND "total" = "subtotal" - "descuento_tope" - "ajuste_redondeo"
  AND "total" % 50 = 0
);

-- Least privilege for parkapp_app (S2-19): cap versions are only closed, never
-- edited (RI-08), as with the rate and the grace period. estadia and comprobante
-- already grant INSERT on every column, and no UPDATE on these new columns.
GRANT SELECT, INSERT ON tope_periodo TO parkapp_app;
GRANT UPDATE (vigente_hasta) ON tope_periodo TO parkapp_app;
GRANT USAGE ON SEQUENCE tope_periodo_id_seq TO parkapp_app;

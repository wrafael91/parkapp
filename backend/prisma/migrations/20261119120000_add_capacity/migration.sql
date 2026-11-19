-- Spaces per vehicle type (BR-19, S3-09, #110): versioned like the rate, so every
-- change keeps the previous value (BR-12). Free spaces are not stored: they are the
-- spaces minus the active stays of the type. Compatible with the previous version of
-- the API, which runs until the deploy switches versions: no existing table changes.

-- AddEnumValue: the administrator sets the spaces of a type or removes its limit,
-- and an entry is rejected when its type has no free spaces.
ALTER TYPE "accion_auditoria" ADD VALUE 'CUPO_CAMBIADO';
ALTER TYPE "accion_auditoria" ADD VALUE 'INGRESO_RECHAZADO_SIN_CUPO';

-- CreateTable
CREATE TABLE "cupo" (
    "id" SERIAL NOT NULL,
    "tipo_vehiculo" "tipo_vehiculo" NOT NULL,
    "cupos" INTEGER NOT NULL,
    "vigente_desde" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_hasta" TIMESTAMPTZ(3),
    "creado_por_id" INTEGER NOT NULL,

    CONSTRAINT "cupo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cupo_creado_por_id_idx" ON "cupo"("creado_por_id");

-- AddForeignKey
ALTER TABLE "cupo" ADD CONSTRAINT "cupo_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules (docs/modelo-datos.md, section 3.2). Every CHECK evaluates to true
-- or false, never NULL, as in S3-03.

-- RI-21: from 0 to 10,000 spaces. 0 means the lot does not take that type.
ALTER TABLE "cupo" ADD CONSTRAINT "cupo_cupos_validos" CHECK ("cupos" BETWEEN 0 AND 10000);

-- RI-07: every version ends after it starts, and each vehicle type has at most one
-- current version. No current version means no limit.
ALTER TABLE "cupo" ADD CONSTRAINT "cupo_vigencia_valida" CHECK (
  "vigente_hasta" IS NULL OR "vigente_hasta" > "vigente_desde"
);
CREATE UNIQUE INDEX "cupo_vigente_unico" ON "cupo" ("tipo_vehiculo") WHERE "vigente_hasta" IS NULL;

-- Least privilege for parkapp_app (S2-19): versions are only closed, never edited or
-- deleted (RI-08), as with the rate, the grace period and the period cap.
GRANT SELECT, INSERT ON "cupo" TO parkapp_app;
GRANT UPDATE ("vigente_hasta") ON "cupo" TO parkapp_app;
GRANT USAGE ON SEQUENCE "cupo_id_seq" TO parkapp_app;

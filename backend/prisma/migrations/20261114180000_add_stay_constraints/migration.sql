-- Integrity rules of docs/modelo-datos.md (section 2.3) that a CHECK constraint or a
-- unique index can express (S3-03, #6), part 1 of 3: stays. The rules that need
-- triggers come later. Every CHECK evaluates to true or false, never NULL, so a
-- missing value cannot pass.

-- RI-01: the plate is stored normalized, with the format of its vehicle type.
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_placa_formato" CHECK (
  ("tipo_vehiculo" = 'CARRO' AND "placa" ~ '^[A-Z]{3}[0-9]{3}$')
  OR ("tipo_vehiculo" = 'MOTO' AND "placa" ~ '^[A-Z]{3}[0-9]{2}[A-Z]$')
);

-- RI-02: a plate has at most one active stay (BR-03).
CREATE UNIQUE INDEX "estadia_placa_activa_unica" ON "estadia" ("placa") WHERE "estado" = 'ACTIVA';

-- RI-03: the status matches the exit and void data. A voided stay may or may not have
-- an exit, depending on whether it was active or closed when it was voided.
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_estado_coherente" CHECK (
  CASE "estado"
    WHEN 'ACTIVA' THEN
      "hora_salida" IS NULL AND "salida_por_id" IS NULL
      AND "anulada_en" IS NULL AND "anulada_por_id" IS NULL AND "motivo_anulacion" IS NULL
    WHEN 'CERRADA' THEN
      "hora_salida" IS NOT NULL AND "salida_por_id" IS NOT NULL
      AND "anulada_en" IS NULL AND "anulada_por_id" IS NULL AND "motivo_anulacion" IS NULL
    WHEN 'ANULADA' THEN
      "anulada_en" IS NOT NULL AND "anulada_por_id" IS NOT NULL
      AND "motivo_anulacion" IS NOT NULL AND btrim("motivo_anulacion") <> ''
      AND ("hora_salida" IS NULL) = ("salida_por_id" IS NULL)
    ELSE false
  END
);

-- RI-05: the exit is not before the entry.
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_salida_posterior_ingreso" CHECK (
  "hora_salida" IS NULL OR "hora_salida" >= "hora_ingreso"
);

-- RI-19 (part): a replacement points to a stay other than itself.
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_reemplazo_distinto" CHECK (
  "reemplaza_a_id" IS NULL OR "reemplaza_a_id" <> "id"
);

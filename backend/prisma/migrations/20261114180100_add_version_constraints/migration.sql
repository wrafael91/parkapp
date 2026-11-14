-- Integrity rules that a CHECK constraint or a unique index can express (S3-03, #6),
-- part 2 of 3: legal cap, rate and grace period versions.

-- RI-07: every version ends after it starts, and there is at most one current version
-- of the legal cap and of the rate per vehicle type, and one of the grace period.
ALTER TABLE "tope_legal" ADD CONSTRAINT "tope_legal_vigencia_valida" CHECK (
  "vigente_hasta" IS NULL OR "vigente_hasta" > "vigente_desde"
);
ALTER TABLE "tarifa" ADD CONSTRAINT "tarifa_vigencia_valida" CHECK (
  "vigente_hasta" IS NULL OR "vigente_hasta" > "vigente_desde"
);
ALTER TABLE "periodo_gracia" ADD CONSTRAINT "periodo_gracia_vigencia_valida" CHECK (
  "vigente_hasta" IS NULL OR "vigente_hasta" > "vigente_desde"
);
CREATE UNIQUE INDEX "tope_legal_vigente_unico" ON "tope_legal" ("tipo_vehiculo")
  WHERE "vigente_hasta" IS NULL;
CREATE UNIQUE INDEX "tarifa_vigente_unica" ON "tarifa" ("tipo_vehiculo")
  WHERE "vigente_hasta" IS NULL;
CREATE UNIQUE INDEX "periodo_gracia_vigente_unico" ON "periodo_gracia" (("vigente_hasta" IS NULL))
  WHERE "vigente_hasta" IS NULL;

-- RI-09 (part): the legal cap and the rate are greater than zero. That the rate does
-- not exceed the cap needs a trigger.
ALTER TABLE "tope_legal" ADD CONSTRAINT "tope_legal_valor_positivo" CHECK ("valor_minuto" > 0);
ALTER TABLE "tarifa" ADD CONSTRAINT "tarifa_valor_positivo" CHECK ("valor_minuto" > 0);

-- RI-10: the grace period is zero or more whole minutes (the column is an integer).
ALTER TABLE "periodo_gracia" ADD CONSTRAINT "periodo_gracia_minutos_no_negativos" CHECK (
  "minutos" >= 0
);

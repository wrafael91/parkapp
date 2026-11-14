-- Integrity rules that a CHECK constraint or a unique index can express (S3-03, #6),
-- part 3 of 3: receipts, accounts and the audit log.

-- RI-12 (part): the total is the subtotal minus a rounding adjustment of $0 to $49,
-- and a multiple of $50; no amount is negative. That a receipt never changes is
-- already enforced by the privileges of parkapp_app (no UPDATE on comprobante).
ALTER TABLE "comprobante" ADD CONSTRAINT "comprobante_valores_validos" CHECK (
  "minutos_completos" >= 0
  AND "subtotal" >= 0
  AND "ajuste_redondeo" BETWEEN 0 AND 49
  AND "total" = "subtotal" - "ajuste_redondeo"
  AND "total" % 50 = 0
);

-- RI-15: the email is unique regardless of case. The API and the bootstrap script
-- already store it in lowercase; this index also covers any other writer.
CREATE UNIQUE INDEX "usuario_correo_sin_mayusculas_unico" ON "usuario" (lower("correo"));

-- RI-17: in the audit log, entidad and entidad_id are both set or both null.
ALTER TABLE "evento_auditoria" ADD CONSTRAINT "evento_auditoria_entidad_completa" CHECK (
  ("entidad" IS NULL) = ("entidad_id" IS NULL)
);

-- RI-18: the IP can only be null when the event has no user (system events such as
-- the bootstrap scripts).
ALTER TABLE "evento_auditoria" ADD CONSTRAINT "evento_auditoria_ip_con_usuario" CHECK (
  "ip" IS NOT NULL OR "usuario_id" IS NULL
);

-- CreateEnum
CREATE TYPE "rol" AS ENUM ('OPERADOR', 'ADMINISTRADOR');

-- CreateEnum
CREATE TYPE "tipo_vehiculo" AS ENUM ('CARRO', 'MOTO');

-- CreateEnum
CREATE TYPE "estado_estadia" AS ENUM ('ACTIVA', 'CERRADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "accion_auditoria" AS ENUM ('INICIO_SESION_EXITOSO', 'INICIO_SESION_FALLIDO', 'ACCESO_DENEGADO', 'INGRESO_REGISTRADO', 'INGRESO_RECHAZADO_PLACA_ACTIVA', 'SALIDA_REGISTRADA', 'ESTADIA_ANULADA', 'TARIFA_CAMBIADA', 'PERIODO_GRACIA_CAMBIADO', 'CUENTA_CREADA', 'CUENTA_DESACTIVADA', 'CUENTA_REACTIVADA', 'CONTRASENA_RESTABLECIDA', 'CONTRASENA_CAMBIADA');

-- CreateTable
CREATE TABLE "usuario" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "hash_contrasena" TEXT NOT NULL,
    "rol" "rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "debe_cambiar_contrasena" BOOLEAN NOT NULL DEFAULT true,
    "bloqueado_hasta" TIMESTAMPTZ(3),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesion" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultima_actividad_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMPTZ(3) NOT NULL,
    "revocada_en" TIMESTAMPTZ(3),

    CONSTRAINT "sesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tope_legal" (
    "id" SERIAL NOT NULL,
    "tipo_vehiculo" "tipo_vehiculo" NOT NULL,
    "valor_minuto" INTEGER NOT NULL,
    "con_sello_oro" BOOLEAN NOT NULL,
    "norma" TEXT NOT NULL,
    "vigente_desde" TIMESTAMPTZ(3) NOT NULL,
    "vigente_hasta" TIMESTAMPTZ(3),

    CONSTRAINT "tope_legal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarifa" (
    "id" SERIAL NOT NULL,
    "tipo_vehiculo" "tipo_vehiculo" NOT NULL,
    "valor_minuto" INTEGER NOT NULL,
    "tope_legal_id" INTEGER NOT NULL,
    "vigente_desde" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_hasta" TIMESTAMPTZ(3),
    "creada_por_id" INTEGER NOT NULL,

    CONSTRAINT "tarifa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periodo_gracia" (
    "id" SERIAL NOT NULL,
    "minutos" INTEGER NOT NULL,
    "vigente_desde" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_hasta" TIMESTAMPTZ(3),
    "creado_por_id" INTEGER NOT NULL,

    CONSTRAINT "periodo_gracia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estadia" (
    "id" SERIAL NOT NULL,
    "placa" TEXT NOT NULL,
    "tipo_vehiculo" "tipo_vehiculo" NOT NULL,
    "color" TEXT NOT NULL,
    "marca" TEXT,
    "estado" "estado_estadia" NOT NULL DEFAULT 'ACTIVA',
    "hora_ingreso" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingreso_por_id" INTEGER NOT NULL,
    "tarifa_id" INTEGER NOT NULL,
    "periodo_gracia_id" INTEGER NOT NULL,
    "hora_salida" TIMESTAMPTZ(3),
    "salida_por_id" INTEGER,
    "anulada_en" TIMESTAMPTZ(3),
    "anulada_por_id" INTEGER,
    "motivo_anulacion" TEXT,

    CONSTRAINT "estadia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobante" (
    "id" SERIAL NOT NULL,
    "consecutivo" SERIAL NOT NULL,
    "estadia_id" INTEGER NOT NULL,
    "minutos_completos" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "ajuste_redondeo" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "comprobante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_auditoria" (
    "id" BIGSERIAL NOT NULL,
    "accion" "accion_auditoria" NOT NULL,
    "usuario_id" INTEGER,
    "entidad" TEXT NOT NULL,
    "entidad_id" INTEGER,
    "detalle" JSONB,
    "ip" TEXT,
    "ocurrido_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_correo_key" ON "usuario"("correo");

-- CreateIndex
CREATE UNIQUE INDEX "sesion_token_hash_key" ON "sesion"("token_hash");

-- CreateIndex
CREATE INDEX "sesion_usuario_id_idx" ON "sesion"("usuario_id");

-- CreateIndex
CREATE INDEX "tarifa_tope_legal_id_idx" ON "tarifa"("tope_legal_id");

-- CreateIndex
CREATE INDEX "tarifa_creada_por_id_idx" ON "tarifa"("creada_por_id");

-- CreateIndex
CREATE INDEX "periodo_gracia_creado_por_id_idx" ON "periodo_gracia"("creado_por_id");

-- CreateIndex
CREATE INDEX "estadia_ingreso_por_id_idx" ON "estadia"("ingreso_por_id");

-- CreateIndex
CREATE INDEX "estadia_salida_por_id_idx" ON "estadia"("salida_por_id");

-- CreateIndex
CREATE INDEX "estadia_anulada_por_id_idx" ON "estadia"("anulada_por_id");

-- CreateIndex
CREATE INDEX "estadia_tarifa_id_idx" ON "estadia"("tarifa_id");

-- CreateIndex
CREATE INDEX "estadia_periodo_gracia_id_idx" ON "estadia"("periodo_gracia_id");

-- CreateIndex
CREATE UNIQUE INDEX "comprobante_consecutivo_key" ON "comprobante"("consecutivo");

-- CreateIndex
CREATE UNIQUE INDEX "comprobante_estadia_id_key" ON "comprobante"("estadia_id");

-- CreateIndex
CREATE INDEX "evento_auditoria_usuario_id_idx" ON "evento_auditoria"("usuario_id");

-- CreateIndex
CREATE INDEX "evento_auditoria_accion_entidad_entidad_id_ocurrido_en_idx" ON "evento_auditoria"("accion", "entidad", "entidad_id", "ocurrido_en");

-- AddForeignKey
ALTER TABLE "sesion" ADD CONSTRAINT "sesion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifa" ADD CONSTRAINT "tarifa_tope_legal_id_fkey" FOREIGN KEY ("tope_legal_id") REFERENCES "tope_legal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifa" ADD CONSTRAINT "tarifa_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periodo_gracia" ADD CONSTRAINT "periodo_gracia_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_ingreso_por_id_fkey" FOREIGN KEY ("ingreso_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_salida_por_id_fkey" FOREIGN KEY ("salida_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_anulada_por_id_fkey" FOREIGN KEY ("anulada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_tarifa_id_fkey" FOREIGN KEY ("tarifa_id") REFERENCES "tarifa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_periodo_gracia_id_fkey" FOREIGN KEY ("periodo_gracia_id") REFERENCES "periodo_gracia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante" ADD CONSTRAINT "comprobante_estadia_id_fkey" FOREIGN KEY ("estadia_id") REFERENCES "estadia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_auditoria" ADD CONSTRAINT "evento_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

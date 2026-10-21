/*
  Warnings:

  - A unique constraint covering the columns `[reemplaza_a_id]` on the table `estadia` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "accion_auditoria" ADD VALUE 'ESTADIA_CORREGIDA';

-- AlterTable
ALTER TABLE "estadia" ADD COLUMN     "reemplaza_a_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "estadia_reemplaza_a_id_key" ON "estadia"("reemplaza_a_id");

-- AddForeignKey
ALTER TABLE "estadia" ADD CONSTRAINT "estadia_reemplaza_a_id_fkey" FOREIGN KEY ("reemplaza_a_id") REFERENCES "estadia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

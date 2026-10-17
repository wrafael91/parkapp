# ADR 0001: Monolito modular por capas

- **Estado:** aceptada
- **Fecha:** 14 de octubre de 2026

## Contexto

ParkApp atiende un solo parqueadero, con unos 20 usuarios concurrentes (NFR-13)
y un presupuesto de USD 30 al mes (NFR-23). Lo desarrolla una sola persona.
Algunas operaciones deben ser atómicas: la salida y su comprobante se registran
en la misma transacción (RI-11).

## Decisión

La API es una sola aplicación Node.js con Express, organizada en módulos por
dominio (cuentas, estadías, tarifas y auditoría). Cada módulo se divide en capas:
rutas, servicios con las reglas de negocio y acceso a datos con Prisma.

## Alternativas consideradas

- **Microservicios:** ofrecen despliegue y escalado independientes, que el
  sistema no necesita. A cambio, agregan comunicación por red entre servicios,
  transacciones distribuidas y más infraestructura que pagar.
- **Funciones sin servidor (AWS Lambda):** las conexiones a PostgreSQL desde
  Lambda requieren un intermediario de conexiones con costo adicional, y el
  anteproyecto compromete el despliegue en EC2 y RDS.

## Consecuencias

- Es más simple de desarrollar, probar y desplegar, y las transacciones son
  locales.
- El sistema escala como un todo, lo que es aceptable a esta escala.
- La separación en módulos depende de la disciplina del código: ningún módulo
  accede directamente a las tablas de otro.
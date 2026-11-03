# ADR 0009: Respaldos diarios con AWS Backup por el límite del plan gratuito

- **Estado:** aceptada
- **Fecha:** 2 de noviembre de 2026

## Contexto

NFR-18 pide respaldos automáticos diarios de la base de datos, con retención
de 7 días y recuperación a un punto en el tiempo. El diseño (sección 6.2 y
ADR 0004) lo resolvía con los respaldos automáticos de RDS a 7 días, pero la
cuenta usa el plan gratuito de AWS (sección 6.8) y RDS no lo permite: al
crear la base, el 31 de octubre, rechazó los 7 días, y la base quedó con
1 día, el máximo que acepta. El 2 de noviembre se repitió el cambio con la
CLI (`aws rds modify-db-instance --backup-retention-period 7`) y RDS
respondió:

```
An error occurred (FreeTierRestrictionError) when calling the ModifyDBInstance operation: The specified backup retention period exceeds the maximum available to free tier customers. To remove all limitations, upgrade your account plan.
```

La guía de usuario de RDS indica un rango de 0 a 35 días y no menciona este
límite, así que ese mensaje es la evidencia de la restricción.

## Decisión

Los respaldos diarios con 7 días de retención los hace AWS Backup, y los
respaldos automáticos de RDS siguen con 1 día:

1. **Plan `parkapp-diario`:** una instantánea de `parkapp-db` cada día a las
   4:30 a. m., hora de Bogotá, que se borra sola a los 7 días. El trabajo
   debe empezar dentro de los 60 minutos siguientes y terminar en menos de
   3 horas. Las instantáneas se guardan en la bóveda `parkapp-respaldos`.
2. **Hora:** AWS Backup no puede empezar un respaldo de RDS durante las
   ventanas de respaldo (2:00 a 2:30 a. m.) y de mantenimiento (domingos,
   3:00 a 3:30 a. m.) de la base, ni en la hora anterior a ellas. A las 4:30
   queda una hora de margen después de las dos, y el plazo de 60 minutos
   para empezar impide que el trabajo se corra hacia ellas.
3. **Rol `parkapp-backup-rol`:** solo lo puede asumir AWS Backup. Usa la
   política que AWS administra para crear respaldos
   (`AWSBackupServiceRolePolicyForBackup`) y un Deny explícito sobre
   `rds:ModifyDBInstance` y `rds:ModifyDBCluster`. La política administrada
   permite modificar cualquier base de datos de la cuenta, por ejemplo
   cambiar la contraseña del maestro, quitar la protección contra borrado o
   bajar la retención a 0, porque el respaldo continuo lo necesita; las
   instantáneas no lo usan. La base se asigna al plan por su ARN, no por
   etiquetas, para que ningún otro recurso entre por error.
4. **Antes de una migración que cambie tablas existentes** (sección 6.6), se
   toma un respaldo bajo demanda con AWS Backup que también vence a los
   7 días, en lugar de una instantánea manual de RDS, que no vence nunca y
   se sigue cobrando hasta que alguien la borre. La instantánea manual de
   los domingos, mitigación provisional desde el 31 de octubre, deja de
   hacerse.

Así, la base se puede restaurar a cualquiera de los últimos 7 días, desde la
instantánea de ese día, y a cualquier segundo de las últimas 24 horas, con la
recuperación a un punto en el tiempo de RDS. NFR-18 se cumple como está
escrito, con una precisión: mientras la cuenta esté en el plan gratuito, la
recuperación a un punto en el tiempo cubre solo el último día.

La decisión se probó el 2 de noviembre: un respaldo bajo demanda de
`parkapp-db` terminó en unos 4 minutos y quedó programado para borrarse
exactamente 7 días después.

## Alternativas consideradas

- **Solo instantáneas manuales:** no son automáticas, así que NFR-18
  tendría que cambiar. Dependen de que alguien se acuerde de tomarlas y no
  se borran solas.
- **Pasar al plan de pago:** RDS volvería a aceptar los 7 días, pero la
  cuenta perdería la garantía del plan gratuito de no generar cobros.
- **Respaldo continuo de AWS Backup:** daría recuperación a un punto en el
  tiempo de 7 días, pero AWS Backup fija esa retención con la misma llamada
  a RDS (`ModifyDBInstance`) que el plan gratuito rechaza. Además, no se
  puede pedir bajo demanda, así que solo se podría probar esperando el
  horario del plan.
- **`pg_dump` programado en el servidor, con destino S3:** el rol de la EC2
  tendría que poder escribir en S3, y sería código propio que mantener y
  probar, sin recuperación a un punto en el tiempo.

## Consecuencias

- El costo es de unos centavos al mes: son instantáneas de una base de
  pocos MB (sección 6.8).
- Los respaldos quedan en us-east-1. El plan gratuito no permite copias
  entre regiones, y NFR-18 no las pide.
- Todavía no hay aviso si un respaldo falla. Hasta que el monitoreo del
  Sprint 3 lo incluya, se revisa con `aws backup list-backup-jobs`.
- Restaurar, desde AWS Backup o desde RDS, crea una instancia nueva. El
  simulacro de NFR-18 (Sprint 3) puede usar cualquiera de las dos vías
  (sección 6.7).
- Al pasar al plan de pago, la retención de RDS sube a 7 días y se decide si
  el plan de AWS Backup se mantiene.

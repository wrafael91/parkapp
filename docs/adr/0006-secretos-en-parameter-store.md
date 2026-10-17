# ADR 0006: Secretos en Parameter Store y usuarios de base de datos separados

- **Estado:** aceptada
- **Fecha:** 17 de octubre de 2026

## Contexto

Ningún secreto puede estar en el repositorio, y en AWS deben gestionarse con un servicio de secretos (NFR-10). La API necesita conectarse a la base de datos; las migraciones, además, necesitan crear y modificar tablas. La bitácora debe ser de solo inserción (NFR-12).

## Decisión

Los secretos se guardan como parámetros `SecureString` de Parameter Store bajo `/parkapp/prod/`, cifrados con la llave que AWS administra para el servicio. La API los lee al arrancar y los recibe como variables de entorno; no se escriben en archivos del servidor.

La base de datos tiene tres usuarios: el maestro de RDS, solo para la creación inicial y emergencias; `parkapp_migrator`, dueño del esquema, que solo se usa al aplicar migraciones; y `parkapp_app`, que usa la API, con los permisos justos por tabla y, en la bitácora, solo de consulta e inserción.

## Alternativas consideradas

- **AWS Secrets Manager:** cobra USD 0,40 al mes por secreto. Su principal ventaja, la rotación automática, no se necesita a esta escala.
- **Archivo `.env` en el servidor:** deja los secretos en texto plano en el disco, donde pueden copiarse por error o terminar en un respaldo.
- **Un solo usuario de base de datos:** un fallo en la API, como una inyección SQL, tendría permisos para borrar tablas o modificar la bitácora.

## Consecuencias

- No tiene costo.
- Rotar una contraseña es manual: se cambia en PostgreSQL y en Parameter Store, y se reinicia la API.
- Los permisos de `parkapp_app` se otorgan en una migración, así quedan versionados y se pueden probar.
- Las pruebas de NFR-12 verifican que `parkapp_app` no pueda modificar ni borrar eventos de la bitácora.
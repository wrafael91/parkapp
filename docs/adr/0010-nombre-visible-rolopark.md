# ADR 0010: RoloPark como nombre visible y `parkapp` como identificador interno

- **Estado:** aceptada
- **Fecha:** 3 de noviembre de 2026

## Contexto

El producto se presentó como ParkApp en el anteproyecto y en la Entrega 1. Al
comprar el dominio (S2-06, 1 de noviembre), `parkapp.com` estaba ocupado, y en
Colombia ya hay aplicaciones de parqueaderos con nombres parecidos
(`parqueapp.com`, `parkiapp.com`, `wparkapp.com`), así que se registró
`rolopark.com` ("rolo" por Bogotá; sección 6.8 de la arquitectura). Desde
entonces, la aplicación respondía en `rolopark.com` con otro nombre.

`parkapp` también es el nombre de los identificadores internos: el repositorio,
los paquetes, los recursos de AWS (`parkapp-servidor`, `parkapp-db`, los roles y
el bucket), los roles de la base de datos (`parkapp_app`, `parkapp_migrator`),
los parámetros (`/parkapp/prod/`), el servicio, el usuario del sistema y el
documento `ParkApp-Deploy`. Varios no se pueden renombrar sin rehacerlos: el
`sub` de OIDC lleva el nombre del repositorio (ADR 0007), un bucket de S3 no se
renombra y un identificador nuevo de RDS cambia la dirección de la base.

## Decisión

1. **El nombre visible del producto es RoloPark:** la aplicación web (título y
   barra superior), el comprobante, el README y los documentos.
2. **Los identificadores internos siguen como `parkapp`** (y `ParkApp-Deploy`).
   Quien usa la aplicación no los ve, y cambiarlos no le aporta nada. Los
   recursos nuevos siguen la misma convención.
3. Los documentos dicen RoloPark donde hablan del producto y conservan los
   identificadores tal cual. Los ADR 0001 a 0009 no se editan: lo que dicen de
   ParkApp aplica a RoloPark.

## Alternativas consideradas

- **Mantener ParkApp:** no coincide con el dominio, es genérico y lo comparten
  otras aplicaciones (una que se llama así sale primera en los buscadores).
- **Comprar `parkapp.com.co`:** el nombre seguiría siendo genérico y
  compartido, y habría que rehacer buena parte de S2-06 (certificado, CAA,
  DNSSEC y Nginx), además del origen que la API verifica contra CSRF.
- **Renombrar todo, incluidos los identificadores:** rompería el despliegue
  (el `sub` de OIDC en la política de confianza del rol), obligaría a recrear
  el bucket y la base, y cambiaría roles, parámetros y servicio, con el riesgo
  de dejar alguna referencia vieja, sin ningún beneficio para quien usa la
  aplicación.

## Consecuencias

- En el código y la infraestructura se lee `parkapp`, y en la aplicación,
  RoloPark. El README y la sección 2 de la arquitectura lo aclaran.
- La Entrega 1 dice ParkApp; la Entrega 2 usa RoloPark y explica el cambio.
- `modelo-amenazas.md` ya nació con RoloPark y no cambia.

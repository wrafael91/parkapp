# ADR 0007: Administración y despliegue sin SSH ni llaves de larga duración

- **Estado:** aceptada
- **Fecha:** 17 de octubre de 2026

## Contexto

El servidor necesita administración ocasional, y cada cambio en `main` debe desplegarse desde GitHub. SSH obliga a abrir el puerto 22 y a proteger una llave privada. Guardar llaves de acceso de AWS en GitHub crea credenciales de larga duración: si se filtran, dan acceso a la cuenta hasta que alguien las revoque.

## Decisión

- **Administración:** se usa AWS Systems Manager Session Manager. La terminal se abre desde la consola o la CLI de AWS, autenticada con IAM y MFA, sin puerto 22 ni llave SSH, y cada sesión queda registrada en CloudTrail.
- **Despliegue:** GitHub Actions asume un rol de IAM mediante OIDC, con credenciales temporales y solo para el repositorio `wrafael91/parkapp` desde la rama `main`. Sube el artefacto a S3 y ejecuta en el servidor el documento propio `ParkApp-Deploy` de SSM Run Command, no un comando libre.

## Alternativas consideradas

- **SSH con llave:** el puerto 22 queda expuesto a escaneos constantes, y la llave hay que protegerla y rotarla.
- **SSH abierto solo para mi IP:** la IP de la casa cambia, y no funcionaría desde otro lugar.
- **Llaves de acceso de AWS en los secretos de GitHub:** son credenciales de larga duración.
- **Documento genérico `AWS-RunShellScript`:** si el flujo de GitHub se comprometiera, permitiría ejecutar cualquier comando en el servidor. Con un documento propio, lo único posible es desplegar.

## Consecuencias

- No queda ningún puerto de administración abierto ni ninguna credencial permanente de AWS fuera de AWS.
- El agente de SSM viene instalado en Amazon Linux 2023 y solo necesita salida HTTPS, ya permitida en `parkapp-web`.
- Si Session Manager fallara, no habría otra vía de acceso. En ese caso, el servidor se reconstruye desde el repositorio y Parameter Store; los datos están en RDS y no se pierden.
- El proveedor OIDC y el rol se configuran en el Sprint 2.

## Actualización del 31 de octubre de 2026

El primer despliegue falló con `Not authorized to perform sts:AssumeRoleWithWebIdentity`. El evento rechazado en CloudTrail mostró que GitHub enviaba el `sub` `repo:wrafael91@61667502/parkapp@1403355272:ref:refs/heads/main`, y no `repo:wrafael91/parkapp:ref:refs/heads/main`, como esperaba el rol. Desde 2026, en los repositorios creados después del 15 de julio, GitHub incluye en el `sub` los ID inmutables del dueño y del repositorio, para que quien reutilice el nombre de un repositorio borrado no herede la confianza que se le dio ([anuncio de GitHub](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/)).

El rol se cambió para aceptar solo ese `sub`, con `StringEquals`. La decisión no cambia: el despliegue sigue limitado a este repositorio y a la rama `main`, ahora con una restricción más fuerte. Los ID no son secretos, porque los publica la API de GitHub.

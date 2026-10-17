# ADR 0003: Sesión con token aleatorio en una cookie HttpOnly

- **Estado:** aceptada
- **Fecha:** 14 de octubre de 2026

## Contexto

Cerrar sesión o desactivar una cuenta debe invalidar el acceso de inmediato
(NFR-04). El modelo de datos guarda las sesiones en el servidor, con el token
como hash SHA-256 (`docs/modelo-datos.md`, secciones 1.3 y 2.4), y dejó a la
arquitectura la decisión de cómo viaja el token.

## Decisión

Al iniciar sesión, la API genera un token aleatorio de 256 bits, guarda su hash
SHA-256 en la tabla `sesion` y lo envía en una cookie con los atributos
`HttpOnly`, `Secure`, `SameSite=Strict` y `Path=/api`. En cada petición, la API
busca la sesión por el hash del token y verifica que no esté revocada ni
expirada.

## Alternativas consideradas

- **JWT sin estado:** no se puede invalidar antes de que expire, lo que
  contradice NFR-04.
- **JWT con lista de tokens revocados:** vuelve a necesitar estado y una consulta
  por petición, y suma la complejidad de los dos enfoques.
- **Token en `localStorage`:** cualquier script que corra en la página puede
  leerlo, así que un ataque XSS lo roba.

## Consecuencias

- La revocación es inmediata, JavaScript no puede leer el token y, si la base de
  datos se filtra, los hashes no sirven para suplantar sesiones.
- Cada petición hace una consulta a la base de datos, apoyada en el índice
  único de `token_hash`. Es aceptable a esta escala.
- Las cookies exigen protección contra CSRF: `SameSite=Strict` más la
  verificación del encabezado `Origin` en las peticiones que modifican datos. Se
  detalla en el modelo de amenazas (S1-07).
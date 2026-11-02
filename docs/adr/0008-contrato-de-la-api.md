# ADR 0008: Contrato de la API en español y código en inglés

- **Estado:** aceptada
- **Fecha:** 2 de noviembre de 2026

## Contexto

El código usa los nombres en inglés del glosario (`docs/reglas-de-negocio.md`,
sección 8), y la base de datos, los nombres en español del modelo lógico
(`docs/modelo-datos.md`, sección 3.1). La API no tenía una convención propia,
aunque lo que ya existe está en español: `GET /api/salud` responde
`{"estado":"ok"}` y el flujo de la sección 5.3 de la arquitectura usa
`POST /api/estadias/{id}/salida`. Antes de las primeras historias con interfaz
(S2-10 a S2-12) hay que fijar el idioma, el formato de los nombres y la forma
de los errores, para no cambiar después la aplicación web y las pruebas.

## Decisión

1. **Idioma.** Todo lo que viaja por la API está en español: rutas, campos,
   valores de enumeración, y códigos y mensajes de error. El código sigue en
   inglés. La traducción ocurre solo en el borde, en los esquemas de
   validación y de respuesta de cada módulo, y el glosario
   (`docs/reglas-de-negocio.md`, sección 8) es el diccionario del contrato.
2. **Campos** en camelCase, sin tildes ni ñ. Si el campo corresponde a una
   columna, es el nombre de la columna en camelCase: `hora_ingreso` pasa a
   `horaIngreso` y `tipo_vehiculo` a `tipoVehiculo`. Así, el diccionario de
   datos (`docs/modelo-datos.md`, sección 4) también sirve para el contrato.
3. **Rutas** en minúscula, sin tildes ni ñ y con guiones entre palabras. Las
   colecciones van en plural (`/api/estadias`, `/api/tarifas`,
   `/api/usuarios`). Lo que existe una sola vez va en singular: la salida de
   una estadía (`/api/estadias/{id}/salida`), la sesión actual
   (`/api/sesion`) y la salud del sistema (`/api/salud`).
4. **Enumeraciones** con los valores en español de la base de datos (`CARRO`,
   `MOTO`, `ACTIVA`, `OPERADOR`). La tabla de traducción son los `@map` de
   `backend/prisma/schema.prisma`, así que hay una sola fuente.
5. **Fechas y horas** en ISO 8601, en UTC y con milisegundos
   (`2026-11-02T12:11:17.000Z`); la aplicación web las muestra en la hora de
   Bogotá. **Valores en pesos** como enteros, igual que en la base.
6. **Errores** con una sola forma:

   ```json
   {
     "error": {
       "codigo": "PLACA_ACTIVA",
       "mensaje": "Ese vehículo ya está dentro del parqueadero."
     }
   }
   ```

   `codigo` es estable y en mayúsculas, y es lo que leen la aplicación web y
   las pruebas. `mensaje` es para mostrarlo al usuario y nunca lleva detalles
   internos (NFR-07). Códigos base: `ENTRADA_INVALIDA` (400),
   `NO_AUTENTICADO` (401), `ACCESO_DENEGADO` (403), `NO_ENCONTRADO` (404),
   `DEMASIADAS_PETICIONES` (429) y `ERROR_INTERNO` (500). Cada historia agrega
   los suyos.
7. **Excepción:** `GET /api/salud` conserva su forma propia
   (`{"estado":"ok"}` con 200 y `{"estado":"no_disponible"}` con 503), porque
   la lee el documento de despliegue (sección 6.6), no la aplicación web.

## Alternativas consideradas

- **Contrato completo en inglés:** evita la traducción en el borde, pero
  agrega otra frente a la base, que guarda los valores en español, y separa la
  API de los documentos del proyecto, de la bitácora (`ACCESO_DENEGADO`) y de
  lo que ven los usuarios.
- **Campos en snake_case, como las columnas:** obligaría a la aplicación web,
  escrita en JavaScript, a mezclar dos convenciones.
- **Errores con Problem Details (RFC 9457):** es un estándar, pero sus campos
  base están en inglés (`type`, `title`, `detail`) y trae campos que la
  aplicación no usa.

## Consecuencias

- El costo de la decisión es una traducción en cada endpoint: cada módulo
  escribe y prueba la conversión de sus esquemas de entrada y de salida, y un
  campo nuevo exige nombrarlo en los dos idiomas. La referencia son el
  glosario, el diccionario de datos y los `@map`, y las pruebas de cada ruta
  verifican el contrato en español.
- La aplicación web y las pruebas dependen de `codigo`, no del texto de
  `mensaje`, así que los mensajes se pueden mejorar sin romper nada.
- Los nombres sin tildes (`contrasena`, `estadias`) se leen menos naturales,
  pero evitan problemas de codificación en las URL y en los clientes.
- `ACCESO_DENEGADO` es a la vez el código de error del 403 y la acción de
  auditoría que registra ese rechazo (NFR-05).

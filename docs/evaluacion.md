# Evaluación del desempeño y la confiabilidad

| Campo | Valor |
|---|---|
| Proyecto | RoloPark — Sistema de Gestión de Parqueaderos |
| Tarea | S3-12 (#126), S3-13 (#127) y S3-14 (#128) |
| Versión | 1.0 — 26 de noviembre de 2026 |

Este documento reporta el objetivo específico 4 (OE4, `docs/requisitos.md`,
sección 5.1): evaluar el desempeño y la confiabilidad de RoloPark en AWS. Reúne
el simulacro de restauración (NFR-18), la prueba de carga (NFR-13 a NFR-15), el
monitoreo de la disponibilidad (NFR-16), la recuperación del proceso (NFR-17) y
el aviso de fallos de los respaldos (R4 del modelo de amenazas). El procedimiento
completo, con los comandos, está en `infra/load-test/README.md`.

Las horas son de Bogotá (UTC−5). Cuando una hora en UTC hace falta para buscar
algo en CloudWatch, va con su fecha UTC: a las 22:38 del 24 de noviembre en
Bogotá, en UTC ya es el 25. Como el repositorio es público, el documento no
incluye números de cuenta, ARN, ID de recursos, endpoints ni direcciones IP.

## 1. Resumen

| Requisito | Meta | Resultado | Estado |
|---|---|---|---|
| NFR-13 | Ingreso y salida en menos de 500 ms en el percentil 95, con 20 usuarios concurrentes | E1: p95 de 131,2 ms en el ingreso y de 39,8 ms en la salida | Cumple |
| NFR-14 | Historial con filtros en menos de 2 s en el percentil 95, con 100.000 estadías | E2 con 101.762 estadías y sin índices para el historial: p95 de 57,6 ms; el filtro más lento, 65,6 ms | Cumple |
| NFR-15 | Menos del 1 % de errores bajo la carga de NFR-13 | E1: 0 errores en 3.390 peticiones (0 en las 12.937 peticiones medidas de las dos sesiones) | Cumple |
| NFR-16 | Disponibilidad mensual de al menos 99 % | Monitor externo cada 5 minutos, activo desde el 23 de noviembre de 2026 | Se reporta el 13 de diciembre de 2026 |
| NFR-17 | La API se reinicia sola en menos de 1 minuto | Unos 7 s después de matar el proceso (31 de octubre de 2026) | Cumple |
| NFR-18 | Respaldos diarios con 7 días de retención y recuperación a un punto en el tiempo; restauración completa en menos de 2 horas | A un punto en el tiempo: 40 min hasta que la aplicación responde sobre la base restaurada. Desde AWS Backup: 13 min hasta los datos verificados | Cumple, con la precisión del ADR 0009 (recuperación a un punto en el tiempo de 24 horas en el plan gratuito) |
| NFR-21 | Un ingreso en menos de 15 s desde una sola pantalla | — | Pendiente: prueba con 3 usuarios en la visita a los parqueaderos (#53) |
| NFR-22 | Chrome, Edge y Firefox, desde 1024 px | — | Pendiente: prueba manual (#52) |

## 2. Ambiente y método

### 2.1 Ambiente

- **Producción** (`docs/arquitectura.md`, sección 6): una EC2 t4g.micro con
  crédito estándar y una base RDS db.t4g.micro con PostgreSQL 16.15, 20 GB gp3,
  en us-east-1a.
- **Base de la prueba:** la instancia restaurada en el simulacro,
  `parkapp-db-simulacro`, con la misma clase, motor, disco, grupo de parámetros
  (UTC y `rds.force_ssl`), CA y zona que producción. Las estadías sintéticas y
  los ingresos y salidas de la carga existieron solo ahí y desaparecieron al
  borrarla.
- **API de prueba:** un segundo proceso de la versión activa (la que desplegó el
  PR #129), como el usuario del sistema `parkapp`, en `127.0.0.1:3001`, lanzado
  por Session Manager. Su URL se armó en memoria a partir de la de la API,
  cambiando solo el nombre del servidor (`db-url.mjs`), sin imprimirla ni
  escribirla en disco (ADR 0006). Nginx no la expone. No cambiaron el servicio
  `parkapp-api`, `start.sh`, Nginx, los parámetros de `/parkapp/prod/` ni
  `parkapp-db`.
- **Generador:** k6 v2.4.0 (linux-arm64, verificado con el archivo de sumas del
  release), corrido en el servidor contra `127.0.0.1:3001`. Mide el tiempo del
  servidor (API, Prisma y RDS), sin internet, TLS ni Nginx; la red desde Bogotá
  se midió aparte (sección 4.7). Los umbrales hacen que k6 termine con error si
  no se cumple el requisito.
- **Cuentas:** un administrador de carga creado con `create-admin.js` solo en la
  restaurada; el `setup` de k6 crea 20 operadores por `POST /api/usuarios`, con
  contraseñas aleatorias en memoria, e inicia sus sesiones fuera de las métricas.
- **Antes del #50:** con el límite de NFR-08 (100 peticiones por minuto por IP),
  20 usuarios desde una sola IP habrían recibido 429.

### 2.2 Sesiones

| Sesión | Fecha y hora | Qué se hizo |
|---|---|---|
| 1 | Martes 24 de noviembre de 2026, 21:34 a 22:55 | Simulacro a un punto en el tiempo, semilla, calentamiento y E1 |
| 2 | Jueves 26 de noviembre de 2026, 11:32 a 13:07 | E2, E3, ráfaga, CloudWatch, renombre, restauración desde AWS Backup, red desde Bogotá, borrado y limpieza |

Entre las dos sesiones, la restaurada siguió encendida. Durante ellas y entre
ellas no se usó producción ni se fusionaron PR, para que la comparación de datos
fuera exacta y la versión activa no cambiara.

### 2.3 Producción no cambió

`verify-restore.sql` saca, en solo lectura, el conteo y una huella md5 de todas
las filas de cada tabla, la posición de las secuencias, el esquema leído del
catálogo (columnas, restricciones, índices y valores de los enumerados) y los
ajustes (zona horaria, versión y TLS de la conexión). Sus salidas se compararon
con `diff`:

| Momento | Comparación | Resultado |
|---|---|---|
| 24 de noviembre, simulacro | Producción frente a la restaurada | Iguales |
| 24 de noviembre, 22:53:28 | Producción después de la carga frente a antes | Iguales |
| 26 de noviembre, 11:38:58 | Producción antes de la carga frente al martes | Iguales |
| 26 de noviembre, 12:08:21 | Producción después de la carga frente a antes | Iguales |
| 26 de noviembre, 12:39:06 | Restaurada desde AWS Backup frente a producción (martes y jueves) | Iguales |

Producción tenía 23 estadías, 16 comprobantes (consecutivo en 16), 4 usuarios,
39 sesiones, 143 eventos de auditoría, 13 versiones de cupos, 7 de tarifas, 6 de
periodos de gracia, 5 de topes por periodo y 2 topes legales. Esquema: 89
columnas, 44 restricciones, 37 índices y 25 valores de enumerados. Zona horaria
UTC, PostgreSQL 16.15 y TLS 1.3.

## 3. Restauración (NFR-18)

### 3.1 A un punto en el tiempo (24 de noviembre)

La instancia se restauró de `parkapp-db` a una hora fija, con el grupo de
subredes, el grupo de seguridad `parkapp-db`, el grupo de parámetros
`parkapp-postgres16`, la CA y la zona de producción, sin acceso público, sin
respaldos propios ni protección contra borrado, y con la etiqueta
`Temporal=objetivo4`. La hora pedida (5 minutos atrás) quedaba después de la
última hora restaurable que publicaba RDS, así que se usó esta, redondeada al
minuto (hallazgo 3).

| Hito | Hora | Desde T0 |
|---|---|---|
| Última hora restaurable al pedir | 21:40:26 (02:40:26Z del 25) | — |
| Punto pedido | 21:40:00 (02:40:00Z del 25) | — |
| **T0:** petición de restauración, estado `creating` | **21:47:28** | 0 |
| Instancia registrada en RDS | 21:51:35 | 4 min 07 s |
| Evento "Restored from DB instance parkapp-db" | 21:57:42 | 10 min 14 s |
| **T1:** evento "DB instance restarted" (disponible) | **~21:58:09** | **~10 min 41 s** |
| **T2:** configuración revisada | 22:20:45 | 33 min 17 s |
| **T3:** la aplicación responde sobre la restaurada | **22:27:28** | **40 min 00 s** |

- **Tiempo total: 40 minutos, frente a una meta de menos de 2 horas.** Entre T1
  y T2 se perdieron unos 20 minutos porque CloudShell cerró la sesión por
  inactividad mientras esperaba con `aws rds wait` (hallazgo 5); T1 se tomó de
  los eventos de RDS. Sin esa pausa habrían sido unos 20 a 25 minutos. RDS no
  registra un evento al aceptar la petición, así que T0 es la hora anotada en
  CloudShell.
- **RPO:** al lanzar la restauración, la última hora restaurable iba unos
  7 minutos detrás de la hora real. En un incidente se perderían como máximo los
  últimos 5 a 7 minutos, dentro de la ventana de 24 horas del plan gratuito
  (ADR 0009).
- **Configuración:** igual a `parkapp-db` en CA, cifrado, clase, disco gp3 de
  20 GB, PostgreSQL 16.15, sin Multi-AZ, grupo de parámetros, sin acceso
  público, grupo de subredes y zona. Difería solo en la retención de respaldos
  (0 frente a 1 día) y la protección contra borrado, como se pidió. Su único
  grupo de seguridad era `parkapp-db`. En el grupo de parámetros,
  `rds.force_ssl` vale 1 (hallazgo 2).
- **Datos:** iguales a producción (sección 2.3).
- **Aplicación:** la API de prueba respondió `{"estado":"ok"}` sobre la
  restaurada, y el historial con la placa `TST` devolvió las 23 estadías de
  prueba de producción, todas cerradas o anuladas.

### 3.2 Desde AWS Backup (26 de noviembre)

El 24 de noviembre no se pudo restaurar en paralelo desde AWS Backup: RDS
respondió `InstanceQuotaExceeded`, porque el plan gratuito admite 2 instancias
(hallazgo 4). El 26 se hizo en secuencia, después de borrar la primera
restaurada, con el punto más reciente del plan `parkapp-diario`: la instantánea
del 26 de noviembre a las 4:30 a. m. (09:30Z).

| Hito | Hora | Desde T0 |
|---|---|---|
| **T0:** petición de restauración desde la instantánea, estado `creating` | **12:26:06** | 0 |
| Evento "DB instance restarted" | 12:28:55 | 2 min 49 s |
| Evento "Restored from snapshot" | 12:29:08 | 3 min 02 s |
| Cambio al grupo de parámetros `parkapp-postgres16` | 12:30:23 a 12:31:24 | 4 min 17 s a 5 min 18 s |
| **T1:** evento "DB instance restarted" después de aplicar los parámetros (disponible) | **12:31:42** | **5 min 36 s** |
| **T2:** configuración revisada | ~12:37 | ~11 min |
| **Datos verificados** | **12:39:06** | **13 min 00 s** |

- RDS aceptó el punto de recuperación de AWS Backup con el usuario
  administrador, **sin crear un rol de restauración**.
- Fue casi el doble de rápida que la recuperación a un punto en el tiempo
  (5 min 36 s frente a 10 min 41 s hasta estar disponible), porque no reproduce
  el registro de transacciones. El precio es el RPO: recupera la base como
  estaba a las 4:30 a. m. de ese día.
- De T1 a la verificación, unos 7 minutos fueron espera y la medición de la red,
  no trabajo de la restauración.
- **Configuración:** igual a `parkapp-db`, con las mismas dos diferencias
  pedidas; único grupo de seguridad `parkapp-db`.
- **Datos:** iguales a producción del martes y del jueves (sección 2.3).
- Se borró a las 13:01:44, unos 35 minutos después de creada.

### 3.3 Corte con el renombre (26 de noviembre)

En un incidente, la API se pasa a la base restaurada renombrando: primero la
instancia dañada y después la restaurada, que toma el nombre `parkapp-db`. Así
conserva el endpoint y el ARN, y no cambian los parámetros de `/parkapp/prod/`,
la acción de Budgets ni la selección de AWS Backup, que están atadas al ARN
(`docs/arquitectura.md`, sección 6.7). Se midió en la propia restaurada:

| Hito | Hora | Desde el inicio |
|---|---|---|
| Petición de renombre a `parkapp-db-simulacro2` | 12:09:54 | 0 |
| Evento "Renamed instance from parkapp-db-simulacro to parkapp-db-simulacro2" | 12:11:14 (17:11:14Z) | 1 min 20 s |
| Disponible con el nombre nuevo | 12:11:15 | 1 min 21 s |
| Primera conexión desde el servidor con el nombre nuevo | 12:13:13 | 3 min 19 s |

El renombre no reinició la instancia, y el nombre viejo dejó de responder. Los
2 minutos entre el evento y la primera conexión son la propagación del DNS del
nombre nuevo. El corte real, con dos renombres en serie y el reinicio de la API,
se estima en **5 a 8 minutos**.

### 3.4 Lectura

| Vía | Hasta disponible | Hasta verificada | RPO | Para qué incidente |
|---|---|---|---|---|
| A un punto en el tiempo | 10 min 41 s | 40 min (con la aplicación) | 5 a 7 minutos | Daño reciente, de las últimas 24 horas |
| Desde AWS Backup | 5 min 36 s | 13 min (datos) | Hasta un día (instantánea de las 4:30 a. m.) | Daño que se descubre tarde, hasta 7 días atrás |

Con cualquiera de las dos, la restauración, la verificación y el corte quedan
muy por debajo de las 2 horas de NFR-18. En el plan gratuito caben la base dañada
y una sola restaurada: si una restauración sale mal, hay que borrarla antes de
intentar otra.

## 4. Carga (NFR-13 a NFR-15)

### 4.1 Semilla

`seed-history.sql` cargó en la restaurada 100.000 estadías en los 333 días
anteriores (unas 300 por día, entre las 6:00 y las 22:00 de Bogotá), de carros y
motos con placas válidas, el 1 % anuladas, y un comprobante por cada estadía con
salida, en una sola transacción y con `ANALYZE` al final. Corrió como
`parkapp_migrator`, porque `parkapp_app` no puede crear tablas temporales en la
base (hallazgo 1).

- Tardó unos 8,5 s (6,2 s las estadías y 2,0 s los 99.520 comprobantes).
- Quedaron 74.558 carros y 24.473 motos cerradas, y 724 y 245 anuladas.
- Antes de E2, la restaurada tenía 101.762 estadías: las 100.000 de la semilla,
  las 23 de producción y las 1.739 del calentamiento y de E1 (100.785 cerradas y
  977 anuladas, ninguna activa).

### 4.2 Escenarios

| Escenario | Usuarios | Duración | Qué hace cada usuario | Umbral |
|---|---|---|---|---|
| Calentamiento | 5 | 1 min | Ingreso, pausa de 2 a 5 s, salida, pausa de 2 a 5 s | No cuenta |
| E1 (NFR-13 y NFR-15) | 20 | 10 min | El mismo ciclo, con su propia sesión de operador y una placa nueva en cada vuelta (70 % carros) | p95 de ingreso y de salida < 500 ms; errores < 1 % |
| E2 (NFR-14) | 20 | 5 min | Búsquedas en el historial con pausas de 1 a 3 s: un día (40 %), parte de una placa de 1 a 3 caracteres, que suele llegar al límite de 500 resultados (30 %), una placa completa (15 %) o un día con tipo de vehículo (15 %) | p95 < 2 s; errores < 1 % |
| E3 (informativo) | 20 | 3 min | El ciclo de E1 sin pausas | — |
| Ráfaga (informativa) | 20 | Un instante | Los 20 operadores registran un ingreso al mismo tiempo, y luego su salida | — |

### 4.3 E1: ingresos y salidas con 20 usuarios (NFR-13 y NFR-15)

El 24 de noviembre, de 22:40:36 a 22:50:44 (para CloudWatch: 03:40Z a 03:52Z del
25). k6 terminó con código 0: se cumplieron todos los umbrales. Fueron 1.695
ciclos (2,79 por segundo) y **0 errores en 3.390 peticiones**.

| E1 | Ingreso | Salida |
|---|---|---|
| Promedio | 77,6 ms | 19,3 ms |
| Mediana | 62,1 ms | 15,1 ms |
| p90 | 95,4 ms | 27,2 ms |
| **p95 (umbral: 500 ms)** | **131,2 ms** | **39,8 ms** |
| p99 | 426,0 ms | 85,7 ms |
| Máximo | 1,04 s | 556 ms |

El calentamiento previo (44 ciclos) dio un p95 de 273,5 ms en el ingreso y de
42,8 ms en la salida, sin errores. El máximo de 1,04 s coincide con el arranque
de E1, cuando la API abrió las 10 conexiones de su pool (sección 4.6).

### 4.4 E2: historial con 100.000 estadías (NFR-14)

El 26 de noviembre, de 11:40:16 a 11:45:21, con 101.762 estadías y sin índices
para los filtros del historial. k6 terminó con código 0. Fueron 2.951 consultas
(9,68 por segundo) y **0 errores**.

| E2 (umbral del p95: 2 s) | Promedio | Mediana | p90 | **p95** | p99 | Máximo |
|---|---|---|---|---|---|---|
| Historial (todas) | 40,1 ms | 32,2 ms | 49,8 ms | **57,6 ms** | 215,5 ms | 768,7 ms |
| Un día | 42,7 ms | 33,3 ms | 45,7 ms | **54,6 ms** | 184,6 ms | 765,5 ms |
| Día y tipo | 35,7 ms | 29,0 ms | 41,0 ms | **50,3 ms** | 164,2 ms | 683,4 ms |
| Placa completa | 30,8 ms | 21,2 ms | 30,9 ms | **42,4 ms** | 195,8 ms | 743,4 ms |
| Parte de una placa (hasta 500) | 43,9 ms | 34,7 ms | 55,7 ms | **65,6 ms** | 236,9 ms | 768,7 ms |

- El p95 queda unas 35 veces por debajo del umbral. **Decisión: no se agregan
  índices para el historial** (`docs/modelo-datos.md`, sección 4.4). Cada índice
  más haría más lento cada ingreso y cada salida, sin una mejora que el usuario
  note.
- El máximo de unos 0,77 s aparece en los cuatro filtros a la vez, así que fue
  una pausa puntual y no un filtro lento.

### 4.5 E3 y ráfaga: el límite (informativas)

E3, el 26 de noviembre de 11:47:40 a 11:50:44: 20 usuarios sin pausas durante
3 minutos. k6 terminó con código 99, porque el p95 del ingreso pasó de 500 ms,
como se esperaba. Fueron 3.278 ciclos (17,9 por segundo) y **0 errores en 6.556
peticiones**.

| E3 | Promedio | Mediana | p90 | p95 | p99 | Máximo |
|---|---|---|---|---|---|---|
| Ingreso | 787 ms | 874 ms | 1,07 s | 1,15 s | 1,44 s | 2,17 s |
| Salida | 313 ms | 305 ms | 390 ms | 426 ms | 601 ms | 828 ms |

Ráfaga, el 26 de noviembre de 11:54:18 a 11:54:21: los 20 operadores registran un
ingreso en el mismo instante. k6 terminó con código 99. Fueron 20 ciclos y
**0 errores en 40 peticiones**.

| Ráfaga | Mínimo | Mediana | p90 | p95 | Máximo |
|---|---|---|---|---|---|
| Ingreso | 323 ms | 825 ms | 1,34 s | 1,39 s | 1,45 s |
| Salida | 14 ms | 266 ms | 494 ms | 543 ms | 550 ms |

- **Los ingresos simultáneos se atienden en fila.** Cada ingreso toma el candado
  de su tipo de vehículo (BR-19, `docs/modelo-datos.md`, decisión 8) y la
  transacción que espera conserva su conexión; el pool de la API tiene
  10 conexiones. En la ráfaga, los 20 ingresos se repartieron entre 0,32 y
  1,45 s, unos 60 ms por ingreso en serie: en el peor instante, el último
  operador espera cerca de 1,5 s, sin errores.
- Las salidas no toman el candado, pero en la ráfaga también pasaron de 500 ms
  en el p95, porque llegaron mientras los últimos ingresos ocupaban conexiones.
- NFR-13 se mide con E1, el uso realista. E3 muestra el margen: unos 17,9 ciclos
  por segundo, más de 60.000 ingresos y salidas por hora, frente a unos 300
  vehículos al día en un parqueadero.

### 4.6 Uso de recursos (CloudWatch)

**Martes (25 de noviembre en UTC, de 03:35Z a 03:55Z):**

| Momento | CPU de la EC2, promedio / máximo (5 min) | CPU de RDS, máximo por minuto | Conexiones a RDS, máximo |
|---|---|---|---|
| 03:35Z a 03:37Z (semilla) | 1,2 / 3,5 % | 5,2 a 7,8 % | 0 |
| 03:38Z a 03:39Z (calentamiento) | — | 4,1 a 6,0 % | 5 y 1 |
| 03:40Z a 03:50Z (E1) | 4,4 a 4,6 / 4,9 a 7,3 % | **11,4 a 19,9 %** | **10 al arrancar**, luego 2 a 5 |
| 03:51Z a 03:54Z | 1,6 / 4,6 % | 4,4 a 6,4 % | 0 |

**Jueves (26 de noviembre en UTC, de 16:35Z a 16:55Z):**

| Momento | CPU de la EC2, promedio / máximo (5 min) | CPU de RDS, máximo por minuto | Conexiones a RDS, máximo |
|---|---|---|---|
| 16:35Z a 16:39Z | 1,1 / 2,2 % | 3,7 a 5,0 % | 0 |
| 16:40Z a 16:45Z (E2) | 10,0 / 11,4 % | 7,4 a 12,5 % | 3 a 4 |
| 16:48Z a 16:50Z (E3) | 6,0 a 10,3 / **21,5 %** | **65,0, 80,5 y 81,0 %** | **10 todo el tiempo** |
| 16:51Z a 16:54Z (ráfaga a las 16:54:18Z) | — | 19,7 %, luego 3,9 a 5,5 % | 0 (la ráfaga duró 3 s y no se ve) |

- Con uso realista (E1 y E2), RDS no pasó del 20 % de CPU y la EC2 del 11 %.
- En saturación (E3), el límite estuvo en la base y en el pool de 10 conexiones,
  no en la EC2 (hallazgo 12).
- El saldo de créditos de CPU de la EC2 estuvo en 288 (el máximo) todo el
  martes; el jueves bajó a 287,26: E3 gastó menos de un crédito.

### 4.7 Red desde Bogotá

El 26 de noviembre, de 12:29:29 a 12:30:53, desde el PC del autor, 100 peticiones
de solo lectura a `https://rolopark.com/api/salud`:

| Medición | Mediana | p95 |
|---|---|---|
| Petición sobre una conexión abierta | 89 ms | 94 ms |
| Con conexión y TLS nuevos | 305 ms | 323 ms |

La red le suma unos 90 ms a cada acción desde Bogotá: con el p95 de E1, un
ingreso típico se vería en unos 150 a 220 ms en el navegador. Es una medición
aparte: NFR-13 se mide en el servidor.

## 5. Disponibilidad, recuperación del proceso y aviso de respaldos

### 5.1 Monitor externo (NFR-16)

- Desde el 23 de noviembre de 2026 a las ~20:24, UptimeRobot (plan gratuito)
  consulta `https://rolopark.com/api/salud` cada 5 minutos, por HTTPS, y espera
  la palabra `"estado":"ok"`; si falla, avisa por correo. La consulta pasa por
  DNS, TLS, Nginx, la API y la base de datos, porque `/api/salud` responde 503
  si la base no está disponible.
- **Prueba del aviso:** un monitor temporal que buscaba una palabra inexistente
  pasó a caído y el correo llegó a las 20:33:22 del 23 de noviembre. Después se
  borró.
- **Limitaciones:** la resolución es de 5 minutos, y el periodo de evaluación, del
  23 de noviembre al 13 de diciembre de 2026 (unos 19,5 días y unas 5.600
  consultas), no es un mes calendario. El monitor no vigila el vencimiento del
  certificado (R8 del modelo de amenazas).
- **Resultado:** se reporta el 13 de diciembre de 2026, en la versión 1.1 de este
  documento.

### 5.2 Recuperación del proceso (NFR-17)

El 31 de octubre de 2026 se mató la API con `systemctl kill -s SIGKILL`: systemd
programó el reinicio a los 5 s (`Restart=always`, `RestartSec=5`) y la API volvió
a escuchar unos 7 s después. En las dos sesiones de este documento, el proceso
de producción no se reinició: seguía el que arrancó el despliegue del PR #129.

### 5.3 Aviso de fallos de los respaldos (R4)

Desde el 23 de noviembre de 2026, una regla de EventBridge envía a un tema de SNS
los cambios de estado de los trabajos de AWS Backup que terminan en `FAILED`,
`ABORTED` o `EXPIRED`, y el tema avisa por correo (suscripción confirmada). Se
probó el patrón de la regla (un evento `FAILED` coincide y uno `COMPLETED` no) y
se publicó un mensaje de prueba en el tema. Los respaldos del 24, 25 y 26 de
noviembre terminaron en `COMPLETED`.

## 6. Usabilidad y navegadores (NFR-21 y NFR-22)

Pendientes. NFR-21 se mide con 3 usuarios durante la visita a los parqueaderos
(#53), y NFR-22 con la prueba manual en Chrome, Edge y Firefox (#52). Sus
resultados se agregan a este documento.

## 7. Limitaciones

- k6 compartió la CPU de la t4g.micro con las dos API, así que los resultados son
  pesimistas; como la EC2 no pasó del 21,5 %, el efecto fue pequeño.
- Los tiempos son del servidor; la red se midió aparte (sección 4.7).
- La CPU de la EC2 llega en promedios de 5 minutos (monitoreo básico) y no
  muestra picos de segundos: para eso están los percentiles de k6.
- La semilla usa la tarifa, el periodo de gracia y el tope vigentes para todo el
  año, y no crea eventos de auditoría (el historial no los lee).
- Cada escenario se corrió una vez. Con más de un año de historial, la prueba de
  NFR-14 debería repetirse.
- La recuperación a un punto en el tiempo cubre solo 24 horas mientras la cuenta
  esté en el plan gratuito (ADR 0009).

## 8. Hallazgos

| N.º | Hallazgo | Dónde quedó |
|---|---|---|
| 1 | La semilla no corre como `parkapp_app` en AWS: la base no concede permisos a PUBLIC y solo `parkapp_migrator` crea tablas temporales. | `seed-history.sql` y paso 4.1 del README |
| 2 | `parkapp_app` no puede leer `rds.force_ssl`: `verify-restore.sql` lo mostraba como si no fuera RDS. | `verify-restore.sql`; el valor se comprueba en el grupo de parámetros (paso 3.2) |
| 3 | El punto pedido (5 minutos atrás) puede quedar después de la última hora restaurable. | Paso 3.1 del README |
| 4 | El plan gratuito admite 2 instancias de RDS. | Paso 5.4 del README y `docs/arquitectura.md` 6.7 |
| 5 | CloudShell y Session Manager cierran la sesión tras unos 20 minutos sin teclear, aunque haya un comando corriendo. | README (terminales y pasos 3.1 y 3.5) |
| 6 | Los comandos `aws rds` en el servidor responden `AccessDenied`: el rol del servidor no tiene permisos de RDS (mínimo privilegio confirmado). | README (terminales) |
| 7 | Producción antes y después se compara con `verify-restore.sql`, más fuerte que un conteo. | Pasos 4.2 y 4.6 del README |
| 8 | Cada bloque de comandos debe decir en qué terminal va. | README |
| 9 | En CloudShell, una línea sin Enter se une con la siguiente que se pegue; así se perdió un borrado, detectado a los 4 minutos. | README (terminales y paso 5.3) |
| 10 | El registro de la API de prueba lo crea el usuario `parkapp`: se borra con `sudo`. | Paso 5.6 del README |
| 11 | Bajo carga, `pg` avisa que llamar a `client.query()` con otra consulta en curso dejará de funcionar en `pg` 9; viene de `@prisma/adapter-pg` 7.10.1 con concurrencia, no del código propio, y no causó errores. | `docs/modelo-amenazas.md` (R19) y backlog |
| 12 | En saturación, el cuello de botella es la base y el pool de 10 conexiones, no la CPU de la EC2. | `docs/arquitectura.md` 6.7 y backlog |
| 13 | Las horas UTC deben ir con su fecha UTC. | Paso 4.5 del README y este documento |

## 9. Limpieza y costo

- `parkapp-db-simulacro`, ya renombrada, se borró el 26 de noviembre a las
  12:21:11, después de unas 38 h 34 min; la restaurada desde AWS Backup, a las
  13:01:44.
- Comprobación final (13:02): solo quedó `parkapp-db`, sin instantáneas manuales
  de las temporales ni respaldos automáticos retenidos.
- Servidor (13:06): se borraron k6, los instrumentos y el registro de la API de
  prueba; solo escucha el puerto 3000, y `parkapp-api` siguió activo y
  respondiendo `{"estado":"ok"}`.
- **Costo:** el gasto del mes pasó de USD 19,34 (24 de noviembre, 21:34) a
  USD 20,91 (26 de noviembre, 11:32), unos USD 0,99 al día con la restaurada.
  La proyección al 30 de noviembre fue de USD 25,5 a 26,5, por debajo de los
  USD 28 que se fijaron como límite para hacer la prueba y del presupuesto de
  USD 30.

## 10. Evidencia

Las capturas de cada paso las conserva el autor: los tiempos y la comparación de
datos de las dos restauraciones, los resúmenes de k6 de E1, E2, E3 y la ráfaga,
CloudWatch de las dos ventanas, el renombre, la comprobación final con solo
`parkapp-db` y la medición de la red. Las que se publiquen tapan el número de
cuenta, la línea del servidor de RDS, el Session ID, el Instance ID, el correo y
cualquier contraseña o URL de conexión; las que muestran datos de la cuenta (como
el `AccessDenied` del hallazgo 6 o el evento que trae el identificador del
trabajo de AWS Backup) no se publican.

## Historial de cambios

| Versión | Fecha | Cambios |
|---|---|---|
| 1.0 | 26 de noviembre de 2026 | Versión inicial: simulacro de restauración a un punto en el tiempo y desde AWS Backup, corte con el renombre (NFR-18); prueba de carga E1, E2, E3 y ráfaga, con CloudWatch y la red desde Bogotá (NFR-13 a NFR-15); monitor externo (NFR-16), recuperación del proceso (NFR-17) y aviso de fallos de los respaldos (R4); limitaciones y hallazgos. S3-12 (#126), S3-13 (#127) y S3-14 (#128) |

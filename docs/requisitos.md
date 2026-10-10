# Requisitos

| Campo | Valor |
|---|---|
| Proyecto | ParkApp — Sistema de Gestión de Parqueaderos |
| Tarea | S1-03 (#4), S1-04 (#5) |
| Versión | 1.1 — 10 de octubre de 2026 |

Este documento se deriva de las reglas de negocio (`docs/reglas-de-negocio.md`).
Cada requisito se traza a las reglas BR-XX que lo originan.

## 1. Actores y permisos

### 1.1 Actores

| Actor | Descripción | Usa la aplicación |
|---|---|---|
| Operador | Registra ingresos y salidas, y entrega el comprobante de pago. | Sí |
| Administrador | Configura la tarifa y el periodo de gracia, gestiona las cuentas de operador, anula registros y consulta el historial. También puede operar. | Sí |
| Cliente | Propietario o conductor del vehículo. Recibe el comprobante. | No |
| Mantenedor de la plataforma | Actualiza el tope legal y la condición de Sello Oro mediante migraciones versionadas en el repositorio (BR-15). | No |

### 1.2 Matriz de permisos

| Acción | Operador | Administrador | Regla |
|---|---|---|---|
| Iniciar y cerrar sesión | ✓ | ✓ | — |
| Registrar ingreso | ✓ | ✓ | BR-02, BR-03, BR-16 |
| Registrar salida y emitir comprobante | ✓ | ✓ | BR-04 a BR-08, BR-14 |
| Buscar una estadía activa por placa | ✓ | ✓ | BR-13 |
| Ver los vehículos que están dentro | ✓ | ✓ | — |
| Anular un registro o comprobante | ✗ | ✓ | BR-12 |
| Configurar la tarifa por tipo de vehículo | ✗ | ✓ | BR-09, BR-10, BR-11 |
| Configurar el periodo de gracia | ✗ | ✓ | BR-08, BR-11 |
| Crear y desactivar cuentas de operador | ✗ | ✓ | — |
| Consultar el historial de estadías y comprobantes | ✗ | ✓ | — |
| Consultar la bitácora de auditoría | ✗ | ✓ | BR-12 |
| Modificar el tope legal o el Sello Oro | ✗ | ✗ | BR-15 (solo por migración) |

✓ permitido, ✗ denegado. En el Sprint 2, cada ✗ se verifica con una prueba
automatizada en la que la API responde 403.

### 1.3 Decisiones de control de acceso

1. **El administrador también opera.** En un parqueadero pequeño el dueño suele
   cubrir turnos. El riesgo de fraude en caja proviene de los operadores, no del
   propietario.
2. **Quien cobra no anula.** El operador no puede anular registros ni
   comprobantes. Esta segregación de funciones impide el fraude de cobrar en
   efectivo, anular el registro y quedarse con el dinero. Toda anulación queda
   con motivo, usuario y fecha (BR-12).
3. **No hay registro público de cuentas.** El administrador crea las cuentas de
   operador, y la primera cuenta de administrador se crea con un script de
   arranque durante el despliegue. Las cuentas no se borran, solo se desactivan,
   para que cada registro conserve la identidad de quien lo hizo (BR-02, BR-12).

4. **Nadie conoce la contraseña de otro usuario.** Cuando el administrador
   restablece la contraseña de un operador, este debe cambiarla en su siguiente
   inicio de sesión. Si el administrador la conociera, podría actuar en nombre
   del operador, y se perdería la trazabilidad de quién hizo cada registro.
   
## 2. Requisitos funcionales

### 2.1 Cuentas y sesión

| ID | Requisito | Actor | Origen |
|---|---|---|---|
| FR-01 | El sistema permite iniciar sesión con correo y contraseña. Una cuenta desactivada no puede iniciar sesión. | Ambos | Sección 1.3 |
| FR-02 | El sistema permite cerrar sesión. | Ambos | — |
| FR-03 | El administrador crea cuentas de operador. No existe registro público. | Administrador | Sección 1.3 |
| FR-04 | El administrador desactiva y reactiva cuentas de operador. Las cuentas no se borran. | Administrador | Sección 1.3, BR-12 |
| FR-05 | El administrador restablece la contraseña de un operador. El operador debe cambiarla en su siguiente inicio de sesión, antes de usar cualquier otra función. | Administrador | Sección 1.3 |
| FR-06 | Cada usuario puede cambiar su propia contraseña. | Ambos | Sección 1.3 |

### 2.2 Ingreso

| ID | Requisito | Actor | Origen |
|---|---|---|---|
| FR-07 | El sistema registra el ingreso con placa, tipo de vehículo y color (obligatorios) y marca (opcional). La hora y el operador los asigna el servidor. | Ambos | BR-01, BR-02, BR-16 |
| FR-08 | El sistema normaliza la placa (mayúsculas, sin espacios ni guiones) y valida su formato según el tipo de vehículo. | Ambos | BR-02 |
| FR-09 | El sistema rechaza el ingreso de una placa con estadía activa y alerta al operador de una posible placa clonada. | Ambos | BR-03 |
| FR-10 | El sistema lista los vehículos que están dentro del parqueadero. | Ambos | — |
| FR-11 | El sistema permite buscar una estadía activa por placa. | Ambos | BR-13 |

### 2.3 Salida y cobro

| ID | Requisito | Actor | Origen |
|---|---|---|---|
| FR-12 | Al registrar la salida, el sistema muestra los datos del ingreso para que el operador los verifique antes de confirmar. | Ambos | BR-04 |
| FR-13 | El sistema calcula el cobro con la tarifa y el periodo de gracia vigentes al momento del ingreso, sobre minutos completos y redondeado al múltiplo de $50 inferior. La hora de salida la asigna el servidor. | Ambos | BR-05 a BR-08, BR-11, BR-16 |
| FR-14 | El sistema emite el comprobante de pago con los datos de BR-14, visible e imprimible desde el navegador. | Ambos | BR-14 |

### 2.4 Anulaciones

| ID | Requisito | Actor | Origen |
|---|---|---|---|
| FR-15 | El administrador anula una estadía y, si lo tiene, su comprobante, indicando el motivo. El usuario y la fecha los registra el servidor, y nada se borra. | Administrador | BR-12, BR-16 |

### 2.5 Configuración

| ID | Requisito | Actor | Origen |
|---|---|---|---|
| FR-16 | El administrador configura la tarifa por minuto de cada tipo de vehículo, viendo el tope legal vigente. El sistema rechaza una tarifa mayor al tope, y cada cambio crea una versión nueva. | Administrador | BR-09, BR-10, BR-11, BR-15 |
| FR-17 | El administrador configura el periodo de gracia en minutos. Cada cambio crea una versión nueva. | Administrador | BR-08, BR-11 |

### 2.6 Consultas y auditoría

| ID | Requisito | Actor | Origen |
|---|---|---|---|
| FR-18 | El administrador consulta el historial de estadías y comprobantes, con filtros por fechas, placa, operador y estado. | Administrador | BR-12 |
| FR-19 | El administrador consulta la bitácora de auditoría: inicios de sesión (exitosos y fallidos), ingresos, salidas, anulaciones, cambios de configuración y gestión de cuentas. | Administrador | BR-12 |
| FR-20 | El administrador ve un resumen del recaudo por día y por operador. | Administrador | Sección 1.3 |

## 3. Requisitos no funcionales

Las categorías siguen el modelo de calidad ISO/IEC 25010:2023; la de costo se
agrega por la restricción de presupuesto del proyecto. Cada requisito tiene una
meta medible y una forma de verificarla. Los de desempeño y fiabilidad se
evalúan en el Sprint 3, como parte del objetivo específico 4.

### 3.1 Seguridad

| ID | Requisito | Verificación | Sprint |
|---|---|---|---|
| NFR-01 | Las contraseñas se almacenan con un algoritmo de hash adaptativo con sal (Argon2id o bcrypt). Nunca se guardan en texto plano ni de forma reversible. | Revisión de código y prueba automatizada | 2 |
| NFR-02 | Las contraseñas tienen mínimo 15 caracteres y se aceptan hasta 64, sin reglas de composición. Se rechazan las que aparecen en una lista de contraseñas comunes o filtradas, y no se exige cambio periódico (NIST SP 800-63B-4). | Pruebas automatizadas | 2 |
| NFR-03 | Tras 5 intentos fallidos de inicio de sesión en 15 minutos, la cuenta se bloquea durante 15 minutos. Cada intento fallido queda en la bitácora (FR-19). | Prueba automatizada | 2 |
| NFR-04 | La sesión expira tras 30 minutos de inactividad y, como máximo, a las 12 horas. Cerrar sesión o desactivar una cuenta invalida sus sesiones de inmediato. | Prueba automatizada | 2 |
| NFR-05 | Cada petición a la API verifica el rol en el servidor según la matriz de la sección 1.2. Una acción no permitida responde 403 y queda en la bitácora. | Una prueba automatizada por cada ✗ de la matriz | 2 |
| NFR-06 | Toda entrada se valida en el servidor contra un esquema (tipo, formato y longitud), y el acceso a datos usa consultas parametrizadas. | Pruebas automatizadas con entradas inválidas | 2 |
| NFR-07 | Los errores no exponen detalles internos al cliente (trazas, consultas SQL, versiones). El detalle queda solo en los registros del servidor. | Pruebas automatizadas | 2 |
| NFR-08 | La API limita las peticiones por cliente (100 por minuto por IP en general, con un límite más estricto en el inicio de sesión) y responde 429 al superarlo. | Prueba automatizada | 2 |
| NFR-09 | La comunicación usa exclusivamente HTTPS (TLS 1.2 o superior), y la base de datos y sus respaldos están cifrados en reposo. | Revisión de configuración y escaneo TLS | 3 |
| NFR-10 | Ningún secreto (contraseñas, llaves o tokens) está en el repositorio. En AWS, los secretos se gestionan con un servicio de secretos, y GitHub tiene activado el escaneo de secretos. | Escaneo de secretos y revisión | 1 a 3 |
| NFR-11 | Al cierre de cada sprint, las dependencias no tienen vulnerabilidades conocidas de severidad alta o crítica. | npm audit y Dependabot | 1 a 3 |
| NFR-12 | La bitácora de auditoría es de solo inserción: nadie puede modificarla ni borrarla desde la aplicación. Cada evento registra quién, qué, cuándo y desde qué IP. | Pruebas de integridad en la base de datos | 1 |

### 3.2 Eficiencia de desempeño

| ID | Requisito | Verificación | Sprint |
|---|---|---|---|
| NFR-13 | El registro de ingreso y el de salida responden en menos de 500 ms en el percentil 95, con 20 usuarios concurrentes. | Prueba de carga en AWS | 3 |
| NFR-14 | La consulta del historial con filtros responde en menos de 2 s en el percentil 95, con 100.000 estadías registradas (cerca de un año de un parqueadero con 300 vehículos diarios). | Prueba de carga con datos sintéticos | 3 |
| NFR-15 | Bajo la carga de NFR-13, la tasa de errores es menor al 1 %. | Prueba de carga | 3 |

### 3.3 Fiabilidad

| ID | Requisito | Verificación | Sprint |
|---|---|---|---|
| NFR-16 | La disponibilidad mensual es de al menos 99 % (unas 7 horas de caída al mes como máximo). | Monitoreo de disponibilidad durante el periodo de evaluación | 3 |
| NFR-17 | Si el proceso de la API falla, se reinicia automáticamente en menos de 1 minuto. | Detener el proceso y medir la recuperación | 3 |
| NFR-18 | La base de datos tiene respaldos automáticos diarios, con retención de 7 días y recuperación a un punto en el tiempo. Una restauración completa toma menos de 2 horas. | Simulacro de restauración documentado | 3 |

### 3.4 Mantenibilidad

| ID | Requisito | Verificación | Sprint |
|---|---|---|---|
| NFR-19 | Todo cambio entra a `main` por pull request con la integración continua en verde. | Protección de rama | 1 a 3 |
| NFR-20 | Cada ejemplo de la sección 5 de las reglas de negocio es una prueba automatizada, y la lógica de negocio tiene al menos 80 % de cobertura de líneas. | Reporte de cobertura en CI | 2 |

### 3.5 Capacidad de interacción

| ID | Requisito | Verificación | Sprint |
|---|---|---|---|
| NFR-21 | Un operador registra un ingreso desde una sola pantalla, sin recargar la página, en menos de 15 segundos. | Prueba con 3 usuarios | 3 |
| NFR-22 | La interfaz funciona en las dos últimas versiones de Chrome, Edge y Firefox, en pantallas desde 1024 px de ancho. | Prueba manual | 2 |

### 3.6 Costo

| ID | Requisito | Verificación | Sprint |
|---|---|---|---|
| NFR-23 | El costo mensual de la infraestructura en AWS no supera USD 30. AWS Budgets alerta al 80 % y ejecuta una acción automática al 100 %. | Reportes de AWS Budgets | 3 |

## 4. Historias de usuario

Formato: "Como… quiero… para…", con criterios de aceptación "Dado… cuando…
entonces…". Priorización MoSCoW: las historias Must se desarrollan en el
Sprint 2 (objetivo específico 2) y las Should en el Sprint 3. Los elementos de
la sección 7 de las reglas de negocio son Won't en esta versión.

### 4.1 Resumen

| ID | Historia | Requisitos | Prioridad | Sprint |
|---|---|---|---|---|
| US-01 | Iniciar y cerrar sesión | FR-01, FR-02 | Must | 2 |
| US-02 | Crear cuentas de operador | FR-03 | Must | 2 |
| US-03 | Desactivar y reactivar cuentas | FR-04 | Must | 2 |
| US-04 | Restablecer la contraseña de un operador | FR-05 | Should | 3 |
| US-05 | Cambiar mi contraseña | FR-06 | Should | 3 |
| US-06 | Registrar el ingreso de un vehículo | FR-07, FR-08, FR-09 | Must | 2 |
| US-07 | Ver los vehículos que están dentro y buscar por placa | FR-10, FR-11 | Must | 2 |
| US-08 | Registrar la salida y calcular el cobro | FR-12, FR-13 | Must | 2 |
| US-09 | Emitir el comprobante de pago | FR-14 | Must | 2 |
| US-10 | Anular una estadía | FR-15 | Must | 2 |
| US-11 | Configurar la tarifa por minuto | FR-16 | Must | 2 |
| US-12 | Configurar el periodo de gracia | FR-17 | Must | 2 |
| US-13 | Consultar el historial | FR-18 | Should | 3 |
| US-14 | Consultar la bitácora de auditoría | FR-19 | Should | 3 |
| US-15 | Ver el resumen de recaudo | FR-20 | Should | 3 |

### 4.2 Historias y criterios de aceptación

#### US-01 Iniciar y cerrar sesión

**Como** operador o administrador, **quiero** iniciar y cerrar sesión **para**
que solo yo pueda actuar con mi cuenta.

- **Dado** una cuenta activa, **cuando** ingreso el correo y la contraseña correctos, **entonces** accedo a las funciones de mi rol.
- **Dado** una cuenta desactivada, **cuando** intento iniciar sesión, **entonces** el acceso se rechaza con el mismo mensaje que una contraseña incorrecta, para no revelar qué cuentas existen.
- **Dado** 5 intentos fallidos en 15 minutos, **cuando** intento de nuevo, **entonces** la cuenta queda bloqueada durante 15 minutos (NFR-03).
- **Dado** que cerré sesión, **cuando** se reutiliza la sesión anterior, **entonces** la API responde 401.

#### US-02 Crear cuentas de operador

**Como** administrador, **quiero** crear cuentas de operador **para** que cada
persona opere con su propia identidad.

- **Dado** un correo no registrado y una contraseña válida, **cuando** creo la cuenta, **entonces** el operador puede iniciar sesión.
- **Dado** una contraseña de menos de 15 caracteres o que está en la lista de contraseñas filtradas, **cuando** creo la cuenta, **entonces** se rechaza (NFR-02).
- **Dado** que soy operador, **cuando** intento crear una cuenta, **entonces** la API responde 403.

#### US-03 Desactivar y reactivar cuentas

**Como** administrador, **quiero** desactivar la cuenta de un operador **para**
cortar su acceso sin perder el rastro de sus registros.

- **Dado** un operador con sesión abierta, **cuando** desactivo su cuenta, **entonces** su siguiente petición responde 401 (NFR-04).
- **Dado** una cuenta desactivada, **cuando** se consultan sus registros, **entonces** la cuenta y sus registros se conservan.
- **Dado** una cuenta desactivada, **cuando** la reactivo, **entonces** el operador puede volver a iniciar sesión.

#### US-04 Restablecer la contraseña de un operador

**Como** administrador, **quiero** restablecer la contraseña de un operador
**Dado** que restablecí la contraseña de un operador, **cuando** él inicia sesión con ella, **entonces** el sistema le exige cambiarla antes de permitir cualquier otra acción.
**para** que recupere el acceso si la olvida.

- **Dado** un operador, **cuando** restablezco su contraseña, **entonces** sus sesiones abiertas se invalidan y el evento queda en la bitácora.
- **Dado** que soy operador, **cuando** intento restablecer la contraseña de otro usuario, **entonces** la API responde 403.

#### US-05 Cambiar mi contraseña

**Como** usuario, **quiero** cambiar mi contraseña **para** mantener mi cuenta segura.

- **Dado** que ingreso mi contraseña actual y una nueva válida, **cuando** confirmo, **entonces** la contraseña cambia.
- **Dado** que la contraseña actual es incorrecta, **cuando** confirmo, **entonces** el cambio se rechaza.

#### US-06 Registrar el ingreso de un vehículo

**Como** operador, **quiero** registrar el ingreso de un vehículo **para** que
su estadía se cuente desde ese momento.

- **Dado** una placa sin estadía activa, **cuando** registro placa, tipo y color, **entonces** se crea la estadía con la hora del servidor y mi usuario.
- **Dado** que escribo `abc-123`, **cuando** registro el ingreso, **entonces** la placa se guarda como `ABC123`.
- **Dado** una placa con formato inválido para su tipo de vehículo, **cuando** registro el ingreso, **entonces** se rechaza.
- **Dado** una placa con estadía activa, **cuando** intento registrar su ingreso, **entonces** se rechaza con una alerta de posible placa clonada (BR-03).
- **Dado** que la petición incluye una hora de ingreso, **cuando** se registra, **entonces** el sistema la ignora y usa la del servidor (BR-16).

#### US-07 Ver los vehículos que están dentro y buscar por placa

**Como** operador, **quiero** ver los vehículos que están dentro y buscarlos
por placa **para** encontrar rápido la estadía al momento de la salida.

- **Dado** varias estadías activas, **cuando** abro la lista, **entonces** veo placa, tipo, color y hora de ingreso de cada una.
- **Dado** que busco `abc123`, **cuando** existe una estadía activa de `ABC123`, **entonces** aparece como resultado.

#### US-08 Registrar la salida y calcular el cobro

**Como** operador, **quiero** registrar la salida y que el sistema calcule el
cobro **para** no hacer cálculos a mano.

- **Dado** una estadía activa, **cuando** inicio la salida, **entonces** veo los datos del ingreso para verificarlos antes de confirmar (BR-04).
- **Dado** un carro con tarifa de $230 y gracia de 5 minutos que estuvo 37 min 50 s, **cuando** confirmo la salida, **entonces** el cobro es $8.500 (caso 4 de las reglas de negocio).
- **Dado** una moto que estuvo 3 minutos, **cuando** confirmo la salida, **entonces** el cobro es $0 (caso 1).
- **Dado** que la tarifa cambió mientras el vehículo estaba dentro, **cuando** confirmo la salida, **entonces** se cobra con la tarifa vigente al ingreso (BR-11).

#### US-09 Emitir el comprobante de pago

**Como** operador, **quiero** entregar un comprobante **para** que el cliente
tenga constancia de lo que pagó.

- **Dado** una salida confirmada, **cuando** se emite el comprobante, **entonces** muestra placa, ingreso, salida, minutos cobrados, tarifa aplicada, ajuste por redondeo y total (BR-14).
- **Dado** un comprobante en pantalla, **cuando** lo imprimo desde el navegador, **entonces** sale completo en una página.

#### US-10 Anular una estadía

**Como** administrador, **quiero** anular una estadía registrada por error
**para** corregirla sin borrar evidencia.

- **Dado** una estadía, **cuando** la anulo con un motivo, **entonces** queda anulada con mi usuario y la hora del servidor, y se conserva en el historial.
- **Dado** que no escribo un motivo, **cuando** intento anular, **entonces** se rechaza.
- **Dado** que soy operador, **cuando** intento anular, **entonces** la API responde 403 (sección 1.3).

#### US-11 Configurar la tarifa por minuto

**Como** administrador, **quiero** configurar la tarifa por minuto de cada tipo
de vehículo **para** fijar el precio de mi parqueadero dentro de la ley.

- **Dado** un tope de $230 para carro, **cuando** configuro $200, **entonces** se crea una versión nueva, vigente desde ese momento.
- **Dado** un tope de $230 para carro, **cuando** configuro $250, **entonces** se rechaza indicando el tope vigente (BR-10).
- **Dado** una tarifa anterior, **cuando** creo una nueva, **entonces** la anterior se conserva sin cambios (BR-11).

#### US-12 Configurar el periodo de gracia

**Como** administrador, **quiero** configurar el periodo de gracia **para**
no cobrar a quienes salen en pocos minutos.

- **Dado** una gracia de 5 minutos, **cuando** la cambio a 10, **entonces** se crea una versión nueva que solo aplica a los ingresos posteriores (BR-11).
- **Dado** un valor negativo o no entero, **cuando** lo guardo, **entonces** se rechaza.

#### US-13 Consultar el historial

**Como** administrador, **quiero** consultar el historial de estadías y
comprobantes **para** revisar la operación.

- **Dado** estadías de varios días, **cuando** filtro por fechas, placa, operador o estado, **entonces** veo solo las que cumplen el filtro.
- **Dado** 100.000 estadías registradas, **cuando** filtro, **entonces** el resultado llega en menos de 2 segundos (NFR-14).

#### US-14 Consultar la bitácora de auditoría

**Como** administrador, **quiero** consultar la bitácora **para** saber quién
hizo qué y cuándo.

- **Dado** eventos registrados, **cuando** consulto la bitácora, **entonces** veo el usuario, la acción, la fecha y la IP de cada uno.
- **Dado** cualquier usuario, **cuando** intenta modificar o borrar un evento, **entonces** no es posible (NFR-12).

#### US-15 Ver el resumen de recaudo

**Como** administrador, **quiero** ver el recaudo por día y por operador **para**
cuadrar caja con lo que entrega cada operador.

- **Dado** comprobantes de varios operadores en un día, **cuando** abro el resumen, **entonces** veo el total por operador y el total del día.
- **Dado** un comprobante anulado, **cuando** se calcula el resumen, **entonces** no se suma.

## 5. Matriz de trazabilidad

### 5.1 Objetivos específicos

| Objetivo específico | Se cumple con | Requisitos relacionados |
|---|---|---|
| OE1. Diseñar el modelo de datos y la arquitectura | Reglas de negocio, requisitos, modelo de datos, arquitectura y modelo de amenazas (Sprint 1) | Todos los FR (el modelo debe soportarlos); integridad y trazabilidad: BR-03, BR-11, BR-12, BR-15, BR-16, NFR-12 |
| OE2. Desarrollar los módulos de registro y facturación | Historias Must (Sprint 2) y Should (Sprint 3) | FR-01 a FR-20; NFR-01 a NFR-08, NFR-20 |
| OE3. Desplegar en AWS con buenas prácticas de seguridad | Despliegue (Sprint 3) | NFR-09 a NFR-11, NFR-16 a NFR-18, NFR-23 |
| OE4. Evaluar el desempeño y la confiabilidad | Pruebas de carga, disponibilidad y restauración (Sprint 3) | NFR-13 a NFR-18, NFR-21, NFR-22 |

### 5.2 Requisitos funcionales

| Requisito | Origen | Historia |
|---|---|---|
| FR-01 | Sección 1.3 | US-01 |
| FR-02 | — | US-01 |
| FR-03 | Sección 1.3 | US-02 |
| FR-04 | Sección 1.3, BR-12 | US-03 |
| FR-05 | Sección 1.3 | US-04 |
| FR-06 | Sección 1.3 | US-05 |
| FR-07 | BR-01, BR-02, BR-16 | US-06 |
| FR-08 | BR-02 | US-06 |
| FR-09 | BR-03 | US-06 |
| FR-10 | — | US-07 |
| FR-11 | BR-13 | US-07 |
| FR-12 | BR-04 | US-08 |
| FR-13 | BR-05, BR-06, BR-07, BR-08, BR-11, BR-16 | US-08 |
| FR-14 | BR-14 | US-09 |
| FR-15 | BR-12, BR-16 | US-10 |
| FR-16 | BR-09, BR-10, BR-11, BR-15 | US-11 |
| FR-17 | BR-08, BR-11 | US-12 |
| FR-18 | BR-12 | US-13 |
| FR-19 | BR-12 | US-14 |
| FR-20 | Sección 1.3 | US-15 |

Cobertura: las 16 reglas de negocio (BR-01 a BR-16) aparecen en al menos un
requisito funcional, y los 20 requisitos funcionales tienen al menos una
historia de usuario. En el Sprint 2 se agrega una columna con las pruebas que
verifican cada requisito.

## 6. Referencias

International Organization for Standardization & International Electrotechnical
Commission. (2023). *Systems and software engineering — Systems and software
Quality Requirements and Evaluation (SQuaRE) — Product quality model*
(ISO/IEC Standard No. 25010:2023).

National Institute of Standards and Technology. (2025). *Digital identity
guidelines: Authentication and authenticator management* (NIST Special

## 7. Historial de cambios

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 8 de octubre de 2026 | Versión inicial |
| 1.1 | 10 de octubre de 2026 | FR-05 y US-04: una contraseña restablecida debe cambiarse en el siguiente inicio de sesión (hallazgo del modelo de datos, S1-04). Se agrega la decisión 4 de la sección 1.3. |
Publication 800-63B-4). https://doi.org/10.6028/NIST.SP.800-63B-4

OWASP Foundation. (2025). *OWASP Application Security Verification Standard
5.0.0*. https://owasp.org/www-project-application-security-verification-standard/

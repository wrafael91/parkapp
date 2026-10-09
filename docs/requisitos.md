# Requisitos

| Campo | Valor |
|---|---|
| Proyecto | ParkApp — Sistema de Gestión de Parqueaderos |
| Tarea | S1-03 (#4) |
| Versión | 0.1 — 6 de octubre de 2026 (en construcción) |

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

## 2. Requisitos funcionales

### 2.1 Cuentas y sesión

| ID | Requisito | Actor | Origen |
|---|---|---|---|
| FR-01 | El sistema permite iniciar sesión con correo y contraseña. Una cuenta desactivada no puede iniciar sesión. | Ambos | Sección 1.3 |
| FR-02 | El sistema permite cerrar sesión. | Ambos | — |
| FR-03 | El administrador crea cuentas de operador. No existe registro público. | Administrador | Sección 1.3 |
| FR-04 | El administrador desactiva y reactiva cuentas de operador. Las cuentas no se borran. | Administrador | Sección 1.3, BR-12 |
| FR-05 | El administrador restablece la contraseña de un operador. | Administrador | Sección 1.3 |
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

Las categorías siguen el modelo de calidad ISO/IEC 25010. Cada requisito tiene
una meta medible y una forma de verificarla. Los de desempeño y fiabilidad se
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

### 3.5 Usabilidad

| ID | Requisito | Verificación | Sprint |
|---|---|---|---|
| NFR-21 | Un operador registra un ingreso desde una sola pantalla, sin recargar la página, en menos de 15 segundos. | Prueba con 3 usuarios | 3 |
| NFR-22 | La interfaz funciona en las dos últimas versiones de Chrome, Edge y Firefox, en pantallas desde 1024 px de ancho. | Prueba manual | 2 |

### 3.6 Costo

| ID | Requisito | Verificación | Sprint |
|---|---|---|---|
| NFR-23 | El costo mensual de la infraestructura en AWS no supera USD 30. AWS Budgets alerta al 80 % y ejecuta una acción automática al 100 %. | Reportes de AWS Budgets | 3 |

## 4. Historias de usuario

Pendiente.

## 5. Matriz de trazabilidad

Pendiente.

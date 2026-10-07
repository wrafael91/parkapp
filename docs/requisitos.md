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

Pendiente.

## 4. Historias de usuario

Pendiente.

## 5. Matriz de trazabilidad

Pendiente.

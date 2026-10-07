# Reglas de negocio

| Campo | Valor |
|---|---|
| Proyecto | ParkApp — Sistema de Gestión de Parqueaderos |
| Tarea | S1-02 (#3), S1-02b (#N) |
| Versión | 1.1 — 6 de octubre de 2026 |

## 1. Propósito

Este documento define las reglas que rigen el registro de vehículos y el cobro
del servicio de parqueo en ParkApp. Cada regla tiene un identificador único
(BR-XX) para que los requisitos, el código y las pruebas puedan referenciarla.

## 2. Actores

- **Operador:** registra ingresos y salidas, y entrega el comprobante.
- **Administrador:** configura tarifas, topes legales y periodo de gracia; anula registros.
- **Cliente:** propietario o conductor del vehículo. No usa el sistema directamente.

## 3. Marco normativo

En Bogotá, los parqueaderos fuera de vía operan bajo un régimen de libertad
regulada: cada establecimiento fija su tarifa, sin superar el valor máximo por
minuto que establece el Distrito. La norma vigente es el Decreto 652 de 2025
(Único del Sector Movilidad), cuyos artículos 199 y 200 fueron modificados por
el Decreto 026 de 2026. De ella se derivan cuatro restricciones para el sistema:

1. El cobro se liquida por minutos (Acuerdo 356 de 2008, art. 1).
2. No se pueden exigir periodos mínimos de permanencia. Se permiten esquemas más
   económicos, siempre que no superen el cobro por minuto (art. 200, par. 4).
3. El valor final se aproxima al múltiplo de $50 inferior más cercano (art. 200, par. 3).
4. Las tarifas máximas incluyen todos los impuestos, incluido el IVA, y se
   actualizan durante el primer trimestre de cada año (art. 200, par. 1).

El valor máximo por minuto se calcula como VMPM = FTV × FSC × CBPM, donde FTV
es el factor por tipo de vehículo (1,0 para carro y 0,7 para moto), FSC el factor
por Sello Oro (1,1 si aplica, 1,0 si no) y CBPM el costo base por minuto ($230)
(Decreto 652/2025, art. 199, Tabla 9).

Valores máximos por minuto vigentes en 2026 (Decreto 652/2025, art. 200, Tabla 10):

| Tipo de vehículo | Tope general | Tope con Sello Oro |
|---|---|---|
| Carro (automóviles, camperos, camionetas y vehículos pesados) | $230 | $253 |
| Moto | $161 | $177 |

## 4. Reglas

### 4.1 Registro de vehículos

| ID | Regla | Fuente |
|---|---|---|
| BR-01 | El sistema admite dos tipos de vehículo: carro (automóviles, camperos, camionetas y vehículos pesados) y moto. | Decisión de alcance; Decreto 652/2025, art. 199 |
| BR-02 | Cada ingreso registra placa, tipo de vehículo y color (obligatorios), marca (opcional), fecha y hora de ingreso, y el operador que lo registró. | Decisión de diseño |
| BR-03 | Una placa no puede tener más de una estadía activa al mismo tiempo. Si se intenta registrar el ingreso de una placa que ya está dentro, el sistema lo rechaza y alerta al operador (posible placa clonada). | Decisión de diseño |
| BR-04 | Al registrar la salida, el sistema muestra los datos registrados al ingreso para que el operador verifique que coinciden con el vehículo que sale. | Decisión de diseño |

### 4.2 Liquidación del cobro

| ID | Regla | Fuente |
|---|---|---|
| BR-05 | El cobro se liquida por minuto, sin permanencia mínima ni cobro por fracciones. | Acuerdo 356/2008, art. 1; Decreto 652/2025, art. 200, par. 4 |
| BR-06 | Solo se cobran minutos completos. Los segundos de un minuto no completado no se cobran. | Ver sección 6 |
| BR-07 | El valor final se redondea al múltiplo de $50 inferior más cercano. | Decreto 652/2025, art. 200, par. 3 |
| BR-08 | El administrador configura un periodo de gracia en minutos. Si la estadía no lo supera, el cobro es $0. Si lo supera, se cobran todos los minutos desde el ingreso. La comparación con el periodo de gracia se hace sobre los minutos completos (BR-06). | Decreto 652/2025, art. 200, par. 4 |

### 4.3 Tarifas

| ID | Regla | Fuente |
|---|---|---|
| BR-09 | La tarifa por minuto se configura por tipo de vehículo, con IVA incluido. | Decreto 652/2025, art. 200, par. 1 |
| BR-10 | El sistema rechaza una tarifa mayor al tope legal vigente para su tipo de vehículo (ver BR-15). | Decreto 652/2025, art. 200, par. 1 |
| BR-11 | Cada estadía se cobra con la tarifa vigente al momento del ingreso, guardada en el registro de la estadía. Las tarifas no se editan: un cambio crea una versión nueva. | Decisión de diseño |

### 4.4 Integridad y trazabilidad

| ID | Regla | Fuente |
|---|---|---|
| BR-12 | Ningún registro de ingreso, salida o cobro se borra. Un registro equivocado se anula indicando motivo, usuario y fecha. | Decisión de diseño |
| BR-13 | La pérdida del tiquete no genera recargo. La salida se busca por placa y aplica BR-04. Verificar los documentos del propietario es un procedimiento del operador, fuera del sistema. | Decisión de diseño |
| BR-16 | Las fechas y horas de ingreso, salida y anulación las asigna el servidor. El sistema no acepta horas enviadas por el cliente. | Decisión de diseño (prevención de fraude) |

### 4.5 Comprobante de pago

| ID | Regla | Fuente |
|---|---|---|
| BR-14 | El comprobante muestra placa, fecha y hora de ingreso y salida, minutos cobrados, tarifa por minuto aplicada, ajuste por redondeo y total con IVA incluido. | Decreto 652/2025, art. 200, par. 1 |
| BR-15 | El tope legal por tipo de vehículo y la condición de Sello Oro no se editan desde la aplicación. Los mantiene la plataforma mediante una migración versionada en el repositorio, cuyo commit cita el decreto que la origina. El administrador solo configura la tarifa del parqueadero, que no puede superar el tope. | Decreto 652/2025, art. 200, par. 1; segregación de funciones |

## 5. Ejemplos de cálculo

Con tarifa de $230 por minuto para carro, $161 para moto y periodo de gracia de
5 minutos. Estos ejemplos se convierten en casos de prueba del cálculo de cobro (S1-08).

| Caso | Estadía | Minutos completos | Subtotal | Total | Reglas |
|---|---|---|---|---|---|
| 1 | Moto, 3 min | 3 | $0 | $0 | BR-08 |
| 2 | Carro, 5 min 59 s | 5 | $0 | $0 | BR-06, BR-08 |
| 3 | Carro, 6 min | 6 | $1.380 | $1.350 | BR-07, BR-08 |
| 4 | Carro, 37 min 50 s | 37 | $8.510 | $8.500 | BR-06, BR-07 |
| 5 | Moto, 45 min | 45 | $7.245 | $7.200 | BR-07 |
| 6 | Carro, 59 min 59 s | 59 | $13.570 | $13.550 | BR-06, BR-07 |

## 6. Supuestos e interpretaciones

- **BR-06:** la norma no regula los segundos. Se cobra solo el minuto completo
  por coherencia con el criterio de redondeo en favor del consumidor de la
  Superintendencia de Industria y Comercio (Concepto 17-69998 de 2017), que
  el Decreto 026 de 2026 cita como fundamento del redondeo hacia abajo.
- **BR-08:** la norma permite esquemas más económicos que el cobro por minuto,
  pero no regula el periodo de gracia. Se adopta la práctica común: la gracia
  funciona como umbral, no como descuento. Por coherencia con BR-06, el umbral
  se compara contra los minutos completos.

## 7. Fuera de alcance

| Elemento | Razón |
|---|---|
| Bicicletas | No tienen placa, que es el identificador del registro. |
| Tope diario | Es legal y favorece al usuario, pero se pospone para priorizar un incremento funcional. Queda en el backlog del producto. |
| Mensualidades y convenios | No hacen parte del alcance del trabajo de grado. |
| Factura electrónica (DIAN) y desglose de IVA | ParkApp emite un comprobante de pago, no una factura electrónica. |
| Reporte al Registro Distrital de Estacionamientos | Obligación administrativa del operador. |
| Publicación física de tarifas en el establecimiento | Obligación del operador (Decreto 652/2025, art. 200, par. 5). |

## 8. Glosario

Términos del dominio y su nombre en el código:

| Español | Código |
|---|---|
| Estadía | `stay` |
| Tarifa | `rate` |
| Tope legal | `legalCap` |
| Periodo de gracia | `gracePeriod` |
| Comprobante de pago | `receipt` |
| Anulación | `void` |

## 9. Referencias

Alcaldía Mayor de Bogotá. (2025). *Decreto 652 de 2025, Único del Sector Movilidad*.
https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=191872

Alcaldía Mayor de Bogotá. (2026). *Decreto 026 de 2026, por medio del cual se
modifican los artículos 199 y 200 del Decreto Distrital 652 de 2025*. Registro
Distrital No. 8507. https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=192044

Concejo de Bogotá. (2008). *Acuerdo 356 de 2008, por medio del cual se adoptan
medidas para el cobro de estacionamiento de vehículos fuera de vía*.
https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=34306

## 10. Historial de cambios

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 4 de octubre de 2026 | Versión inicial |
| 1.1 | 6 de octubre de 2026 | Se agregan BR-15 (tope legal fuera del alcance del administrador) y BR-16 (horas asignadas por el servidor); se ajusta BR-10 |

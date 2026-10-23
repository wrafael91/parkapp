# Reglas de negocio

| Campo | Valor |
|---|---|
| Proyecto | ParkApp — Sistema de Gestión de Parqueaderos |
| Tarea | S1-02 (#3), S1-02b (#15), S1-03 (#4), S1-04 (#5) |
| Versión | 1.7 — 22 de octubre de 2026 |

## 1. Propósito

Este documento define las reglas que rigen el registro de vehículos y el cobro
del servicio de parqueo en ParkApp. Cada regla tiene un identificador único
(BR-XX) para que los requisitos, el código y las pruebas puedan referenciarla.

## 2. Actores

- **Operador:** registra ingresos y salidas, y entrega el comprobante.
- **Administrador:** configura tarifas y periodo de gracia; anula y corrige registros. No modifica los topes legales (BR-15).
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
es el factor por tipo de vehículo (1,0 para carro y 0,7 para moto), FSC es el factor por la estrategia de sellos de calidad de cicloparqueaderos (1,1 si el parqueadero tiene la certificación Sello Oro y 1,0 si no) y CBPM el costo base por minuto ($230)
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
| BR-11 | Cada estadía se cobra con la tarifa y el periodo de gracia vigentes al momento del ingreso, guardados en el registro de la estadía. Ni las tarifas ni el periodo de gracia se editan: un cambio crea una versión nueva. | Decisión de diseño |
| BR-15 | El tope legal por tipo de vehículo y la condición de Sello Oro no se editan desde la aplicación. Los mantiene la plataforma mediante una migración versionada en el repositorio, cuyo commit cita el decreto que la origina. El administrador solo configura la tarifa del parqueadero, que no puede superar el tope. | Decreto 652/2025, art. 200, par. 1; segregación de funciones |

### 4.4 Integridad y trazabilidad

| ID | Regla | Fuente |
|---|---|---|
| BR-12 | Ningún registro de ingreso, salida o cobro se borra. Un registro equivocado se anula indicando motivo, usuario y fecha. | Decisión de diseño |
| BR-13 | La pérdida del tiquete no genera recargo. La salida se busca por placa y aplica BR-04. Verificar los documentos del propietario es un procedimiento del operador, fuera del sistema. | Decisión de diseño |
| BR-16 | Las fechas y horas de ingreso, salida y anulación las asigna el servidor. El sistema no acepta horas enviadas por el cliente, y una corrección solo copia horas que el servidor ya registró (BR-17). | Decisión de diseño (prevención de fraude) |
| BR-17 | Una estadía con datos equivocados (placa, tipo de vehículo, color o marca) se corrige por reemplazo: el administrador la anula y el sistema crea, en la misma operación, una estadía de reemplazo vinculada a la anulada, con los datos corregidos y las mismas horas que el servidor registró. Si la salida se registró al vehículo equivocado, la estadía cerrada por error se reemplaza por una activa y la del vehículo que realmente salió se cierra con la hora de esa salida. Si cambia el cobro, el reemplazo recibe un comprobante nuevo, y la diferencia con lo ya cobrado se resuelve fuera del sistema. | Decisión de diseño (prevención de errores de cobro) |

BR-17 responde a los errores de digitación: corregir una placa, un tipo de vehículo o una salida equivocada no pierde la hora real de ingreso, y por eso no altera el cobro. Por ejemplo, si a las 8:02 se registra la placa ABC128 en lugar de ABC123 y el error se corrige a las 10:00, el reemplazo conserva el ingreso de las 8:02; si el carro sale a las 10:30, se cobran 148 minutos y no 30.

### 4.5 Comprobante de pago

| ID | Regla | Fuente |
|---|---|---|
| BR-14 | El comprobante muestra placa, fecha y hora de ingreso y salida, minutos cobrados, tarifa por minuto aplicada, ajuste por redondeo y total con IVA incluido. | Decreto 652/2025, art. 200, par. 1 |

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

- **BR-06:** la norma no regula los segundos. Se cobra solo el minuto completo por 
  coherencia con el criterio de redondeo en favor del consumidor de la Superintendencia de 
  Industria y Comercio (2017), que el Decreto 026 de 2026 cita en sus considerandos como
  motivación para el redondeo hacia abajo.
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
| Placas extranjeras y diplomáticas | El registro valida el formato de placa colombiana (FR-08). |
| Registro del medio de pago (efectivo o tarjeta) | ParkApp calcula y registra el valor a cobrar, pero no procesa pagos: el pago se recibe fuera del sistema. El resumen de recaudo (FR-20) totaliza por operador sin distinguir el medio de pago. Queda en el backlog del producto. |
| Recuperación de contraseña por correo | Requiere un servicio de correo y amplía la superficie de ataque. El administrador restablece las contraseñas (FR-05). |

## 8. Glosario

Términos del dominio y su nombre en el código. El nombre de cada columna está en
el diccionario de datos (`docs/modelo-datos.md`, sección 4).

| Español | Código |
|---|---|
| Estadía | `stay` |
| Tarifa | `rate` |
| Tope legal | `legalCap` |
| Periodo de gracia | `gracePeriod` |
| Comprobante de pago | `receipt` |
| Anulación | `void` |
| Usuario | `user` |
| Rol | `role` |
| Operador | `OPERATOR` |
| Administrador | `ADMINISTRATOR` |
| Sesión | `session` |
| Revocación de sesión | `revoke` |
| Bloqueo de cuenta | `lock` |
| Placa | `plate` |
| Tipo de vehículo | `vehicleType` |
| Carro | `CAR` |
| Moto | `MOTORCYCLE` |
| Marca | `brand` |
| Ingreso | `entry` |
| Salida | `exit` |
| Estado de la estadía: activa, cerrada, anulada | `status`: `ACTIVE`, `CLOSED`, `VOIDED` |
| Valor por minuto | `valuePerMinute` |
| Sello Oro | `goldSeal` (atributo `hasGoldSeal`) |
| Norma | `regulation` |
| Vigencia | `validFrom` / `validTo` |
| Consecutivo | `number` |
| Minutos completos | `fullMinutes` |
| Ajuste por redondeo | `roundingAdjustment` |
| Evento de auditoría | `auditEvent` |
| Acción de auditoría | `auditAction` |
| Bitácora de auditoría | `AuditEvent` (el conjunto de eventos) |
| Corrección | `correct` (acción `STAY_CORRECTED`) |
| Reemplazo | `replacement` (atributo `replacesId`) |

## 9. Referencias

Alcaldía Mayor de Bogotá. (2025). *Decreto 652 de 2025, Único del Sector Movilidad*.
https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=191872

Alcaldía Mayor de Bogotá. (2026). *Decreto 026 de 2026, por medio del cual se
modifican los artículos 199 y 200 del Decreto Distrital 652 de 2025*. Registro
Distrital No. 8507. https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=192044

Concejo de Bogotá. (2008). *Acuerdo 356 de 2008, por medio del cual se adoptan
medidas para el cobro de estacionamiento de vehículos fuera de vía*.
https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=34306

Superintendencia de Industria y Comercio. (2017, 4 de mayo). *Concepto 17 69998 del 4 de mayo de 2017*. 
https://sedeelectronica.sic.gov.co/transparencia/normativa/concepto-17-69998-del-4-de-mayo-de-2017

## 10. Historial de cambios

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 4 de octubre de 2026 | Versión inicial |
| 1.1 | 6 de octubre de 2026 | Se agregan BR-15 (tope legal fuera del alcance del administrador) y BR-16 (horas asignadas por el servidor); se ajusta BR-10 |
| 1.2 | 6 de octubre de 2026 | BR-11 se extiende al periodo de gracia, que también se congela al ingreso (hallazgo del análisis de requisitos, S1-03); se agregan dos elementos fuera de alcance |
| 1.3 | 13 de octubre de 2026 | Se amplía el glosario con los términos del modelo de datos (S1-04) |
| 1.4 | 17 de octubre de 2026 | BR-06: redacción ajustada a lo verificable en el Decreto 026 de 2026. Referencia oficial del Concepto 17-69998 de la SIC. Registro del medio de pago declarado fuera del alcance. |
| 1.5 | 20 de octubre de 2026 | BR-17: corrección de estadías por reemplazo, con las horas registradas por el servidor. BR-16 aclara que una corrección solo copia horas ya registradas. Glosario: corregir y reemplazo. |
| 1.6 | 22 de octubre de 2026 | FSC se define con su nombre oficial (factor por la estrategia de sellos de calidad de cicloparqueaderos). Glosario: corrección y reemplazo con el mismo formato de las demás filas. |
| 1.7 | 22 de octubre de 2026 | Actores: el administrador ya no figura como quien configura los topes legales, que contradecía BR-15; se agrega que corrige registros (BR-17). |

# Reglas de negocio

| Campo | Valor |
|---|---|
| Proyecto | RoloPark — Sistema de Gestión de Parqueaderos |
| Tarea | S1-02 (#3), S1-02b (#15), S1-03 (#4), S1-04 (#5), S2-23 (#71), S3-04 (#14), S3-09 (#110), S3-10 (#116), S3-11 (#121), S3-15 (#131) |
| Versión | 1.13 — 26 de noviembre de 2026 |

## 1. Propósito

Este documento define las reglas que rigen el registro de vehículos y el cobro
del servicio de parqueo en RoloPark. Cada regla tiene un identificador único
(BR-XX) para que los requisitos, el código y las pruebas puedan referenciarla.

## 2. Actores

- **Operador:** registra ingresos y salidas, y entrega el comprobante.
- **Administrador:** configura tarifas, periodo de gracia, tope por periodo y cupos; anula y corrige registros. No modifica los topes legales (BR-15).
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
| BR-19 | El administrador puede fijar los cupos de cada tipo de vehículo, de 0 a 10.000. Los cupos libres son los cupos menos los vehículos de ese tipo con estadía activa; las estadías cerradas y anuladas no cuentan. Si no quedan cupos libres de un tipo, el sistema rechaza el ingreso de ese tipo, alerta al operador y registra el intento en la bitácora con los datos del vehículo rechazado; los demás tipos siguen entrando, y la salida nunca se bloquea. Los cupos pueden quedar por debajo de los vehículos que ya están dentro: esos vehículos no se afectan, y los nuevos de ese tipo se rechazan hasta que haya cupo. Un tipo sin cupos configurados no tiene límite. Corregir el tipo de un vehículo que ya está dentro (BR-17) no se rechaza por cupos. Cada cambio crea una versión nueva. | `docs/diagnostico.md` (capacidad de los parqueaderos A y B); decisión del Product Owner (16 y 17 de noviembre de 2026); ver sección 6 |

### 4.2 Liquidación del cobro

| ID | Regla | Fuente |
|---|---|---|
| BR-05 | El cobro se liquida por minuto, sin permanencia mínima ni cobro por fracciones. | Acuerdo 356/2008, art. 1; Decreto 652/2025, art. 200, par. 4 |
| BR-06 | Solo se cobran minutos completos. Los segundos de un minuto no completado no se cobran. | Ver sección 6 |
| BR-07 | El valor final se redondea al múltiplo de $50 inferior más cercano. | Decreto 652/2025, art. 200, par. 3 |
| BR-08 | El administrador configura un periodo de gracia en minutos. Si la estadía no lo supera, el cobro es $0. Si lo supera, se cobran todos los minutos desde el ingreso. La comparación con el periodo de gracia se hace sobre los minutos completos (BR-06). | Decreto 652/2025, art. 200, par. 4 |
| BR-18 | El administrador puede configurar un tope por periodo, igual para carros y motos: un periodo en horas (de 1 a 24) y un valor máximo por periodo. La estadía se divide en bloques del periodo contados desde el ingreso del vehículo, y cada bloque, completo o no, cobra sus minutos completos por la tarifa sin superar el tope. El periodo de gracia (BR-08) solo se aplica al principio de la estadía, y el redondeo (BR-07) se aplica al total. El tope puede estar desactivado, y cada cambio crea una versión nueva (BR-11). | Decreto 652/2025, art. 200, par. 4; retroalimentación de la Entrega 1 y `docs/diagnostico.md` (parqueadero B); ver sección 6 |

### 4.3 Tarifas

| ID | Regla | Fuente |
|---|---|---|
| BR-09 | La tarifa por minuto se configura por tipo de vehículo, con IVA incluido. | Decreto 652/2025, art. 200, par. 1 |
| BR-10 | El sistema rechaza una tarifa mayor al tope legal vigente para su tipo de vehículo (ver BR-15). | Decreto 652/2025, art. 200, par. 1 |
| BR-11 | Cada estadía se cobra con la tarifa, el periodo de gracia y el tope por periodo vigentes al momento del ingreso, guardados en el registro de la estadía. Si al ingreso no había un tope vigente, la estadía se cobra sin tope. Ni las tarifas, ni el periodo de gracia, ni el tope se editan: un cambio crea una versión nueva. | Decisión de diseño |
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
| BR-14 | El comprobante muestra placa, fecha y hora de ingreso y salida, minutos cobrados, tarifa por minuto aplicada, el tope por periodo y su descuento si se aplicó (BR-18), ajuste por redondeo y total con IVA incluido. | Decreto 652/2025, art. 200, par. 1 |

## 5. Ejemplos de cálculo

Con tarifa de $230 por minuto para carro, $161 para moto y periodo de gracia de
5 minutos. Estos ejemplos se convierten en casos de prueba del cálculo de cobro (S2-09).

| Caso | Estadía | Minutos completos | Subtotal | Total | Reglas |
|---|---|---|---|---|---|
| 1 | Moto, 3 min | 3 | $0 | $0 | BR-08 |
| 2 | Carro, 5 min 59 s | 5 | $0 | $0 | BR-06, BR-08 |
| 3 | Carro, 6 min | 6 | $1.380 | $1.350 | BR-07, BR-08 |
| 4 | Carro, 37 min 50 s | 37 | $8.510 | $8.500 | BR-06, BR-07 |
| 5 | Moto, 45 min | 45 | $7.245 | $7.200 | BR-07 |
| 6 | Carro, 59 min 59 s | 59 | $13.570 | $13.550 | BR-06, BR-07 |

Con el esquema del parqueadero B: tarifa de $33 por minuto, tope de $11.000
cada 12 horas y periodo de gracia de 5 minutos. Estos ejemplos se convierten en
casos de prueba en S3-04. El descuento por tope es la diferencia entre el
subtotal y lo que cobran los bloques; el total es el subtotal menos el
descuento, redondeado (BR-07).

| Caso | Estadía | Minutos completos | Subtotal | Descuento por tope | Total | Reglas |
|---|---|---|---|---|---|---|
| 7 | 3 min | 3 | $0 | $0 | $0 | BR-08 |
| 8 | 5 h 33 min | 333 | $10.989 | $0 | $10.950 | BR-07 (el tope todavía no se alcanza) |
| 9 | 5 h 34 min | 334 | $11.022 | $22 | $11.000 | BR-18 |
| 10 | 12 h 1 min | 721 | $23.793 | $12.760 | $11.000 | BR-07, BR-18 (empieza el segundo bloque) |
| 11 | 12 h 3 min | 723 | $23.859 | $12.760 | $11.050 | BR-08, BR-18 (la gracia no se repite en el segundo bloque) |
| 12 | 15 h | 900 | $29.700 | $12.760 | $16.900 | BR-07, BR-18 ($11.000 + $5.940 = $16.940) |
| 13 | 30 h | 1.800 | $59.400 | $26.400 | $33.000 | BR-18 (tres bloques; el último, parcial, también llega al tope) |

Con 3 cupos de carros y 2 de motos. Estos ejemplos se convierten en casos de
prueba en S3-09.

| Caso | Situación | Resultado | Reglas |
|---|---|---|---|
| 14 | Hay 3 carros dentro e intenta entrar otro carro | Se rechaza y queda en la bitácora; quedan 0 cupos libres | BR-19 |
| 15 | Igual que el caso 14, e intenta entrar una moto (ninguna dentro) | Entra: cada tipo tiene sus cupos | BR-19 |
| 16 | Hay 3 carros dentro y sale uno | Queda 1 cupo libre, y el siguiente carro entra | BR-19 |
| 17 | Hay 3 estadías de carro y el administrador anula una | Queda 1 cupo libre: la anulada no cuenta | BR-12, BR-19 |
| 18 | Hay 2 carros dentro y el administrador baja los cupos de carros a 1 | Los 2 carros siguen dentro y los nuevos se rechazan hasta que salgan los 2 | BR-19 |
| 19 | El administrador fija 0 cupos de motos (como el parqueadero B, que no recibe motos) | Ninguna moto entra | BR-19 |
| 20 | No hay cupos configurados para carros | Los carros entran sin límite | BR-19 |

Correcciones de una estadía activa. Estos casos se convierten en pruebas en
S3-10.

| Caso | Situación | Resultado | Reglas |
|---|---|---|---|
| 21 | A las 8:02 se registró la placa ABC128 en lugar de ABC123; el administrador lo corrige a las 10:00 y el carro sale a las 10:30 | ABC128 queda anulada con el motivo, el usuario y la hora; el reemplazo ABC123 conserva el ingreso de las 8:02, y se cobran 148 minutos | BR-12, BR-16, BR-17 |
| 22 | Se registró como moto un vehículo que era carro, y la tarifa de carro cambió después del ingreso | El reemplazo toma la tarifa de carro vigente a la hora del ingreso, no la de hoy | BR-11, BR-17 |
| 23 | Igual que el caso 22, con los cupos de carros llenos | La corrección se hace, porque el carro ya estaba dentro; quedan más carros que cupos, y los nuevos se rechazan hasta que haya cupo | BR-17, BR-19 |
| 24 | Mientras el administrador corrige una estadía, un operador registra su salida | Solo una de las dos se hace; la otra recibe un aviso de que la estadía ya no está activa | BR-12, BR-17 |

Anulaciones sin reemplazo. Estos casos se convierten en pruebas en S3-11.

| Caso | Situación | Resultado | Reglas |
|---|---|---|---|
| 25 | Se registró el ingreso de un carro que no entró al parqueadero | El administrador lo anula con el motivo: queda anulado con su usuario y la hora, se conserva en el historial y su cupo queda libre | BR-12, BR-19 |
| 26 | Una estadía cerrada con el comprobante N.º 7 por $1.000 se le cobró al vehículo equivocado | El administrador la anula: la estadía y su comprobante quedan anulados, se conservan, y el comprobante deja de contar en el recaudo | BR-12, BR-14 |
| 27 | Mientras el administrador anula una estadía activa, un operador registra su salida | Solo una de las dos se hace; si la salida llegó primero, la anulación se rechaza y el administrador ve el comprobante antes de volver a decidir | BR-12 |

## 6. Supuestos e interpretaciones

- **BR-06:** la norma no regula los segundos. Se cobra solo el minuto completo por 
  coherencia con el criterio de redondeo en favor del consumidor de la Superintendencia de 
  Industria y Comercio (2017), que el Decreto 026 de 2026 cita en sus considerandos como
  motivación para el redondeo hacia abajo.
- **BR-08:** la norma permite esquemas más económicos que el cobro por minuto,
  pero no regula el periodo de gracia. Se adopta la práctica común: la gracia
  funciona como umbral, no como descuento. Por coherencia con BR-06, el umbral
  se compara contra los minutos completos.
- **BR-18:** la norma permite esquemas más económicos que el cobro por minuto,
  pero no dice cómo se cuentan los periodos. Los bloques se cuentan desde el
  ingreso de cada vehículo, no por el horario del reloj ni por día calendario:
  así, un carro que entra a las 7 p. m. no paga un segundo tope a medianoche.
  Como cada bloque cobra a lo sumo sus minutos, el cobro nunca supera el de la
  tarifa por minuto, y por eso el tope no se compara con el tope legal. El
  parqueadero B cobra por turnos fijos, y su turno de noche (de 6 p. m. a
  7 a. m.) dura 13 horas: con un periodo de 13 horas, una estadía de hasta 13
  horas paga como máximo el valor de un turno. La diferencia es que en B una
  estadía que cruza el cambio de turno paga dos turnos, y en RoloPark solo
  cuando pasa del periodo. Es una interpretación nuestra, que se valida con B en
  la visita (`docs/diagnostico.md`, sección 6).
- **BR-19:** los cupos libres se calculan con los registros de las estadías, no
  con un contador aparte, para que el número que ve el operador no pueda
  desviarse de lo registrado. El sistema no ve los espacios físicos: si un
  vehículo sale sin que se registre su salida, ocupa un cupo hasta que se
  registre. Rechazar el ingreso cuando no hay cupo evita registrar más vehículos
  de los que caben, y el administrador amplía los cupos si se habilitan más
  espacios. Cada rechazo queda en la bitácora con el operador, para que un
  ingreso sin registro o una salida falsa para liberar un cupo dejen rastro.

## 7. Fuera de alcance

| Elemento | Razón |
|---|---|
| Bicicletas | No tienen placa, que es el identificador del registro. |
| Turnos fijos por horario del reloj (por ejemplo, de 6 p. m. a 7 a. m., con su propio valor) | El tope por periodo (BR-18) cuenta los bloques desde el ingreso. Los turnos por reloj quedan en el backlog del producto hasta validarlos con el parqueadero B en la visita. |
| Mensualidades y convenios | No hacen parte del alcance del trabajo de grado. |
| Factura electrónica (DIAN) y desglose de IVA | RoloPark emite un comprobante de pago, no una factura electrónica. |
| Reporte al Registro Distrital de Estacionamientos | Obligación administrativa del operador. |
| Publicación física de tarifas en el establecimiento | Obligación del operador (Decreto 652/2025, art. 200, par. 5). |
| Placas extranjeras y diplomáticas | El registro valida el formato de placa colombiana (FR-08). |
| Registro del medio de pago (efectivo o tarjeta) | RoloPark calcula y registra el valor a cobrar, pero no procesa pagos: el pago se recibe fuera del sistema. El resumen de recaudo (FR-20) totaliza por operador sin distinguir el medio de pago. Queda en el backlog del producto. |
| Recuperación de contraseña por correo | Requiere un servicio de correo y amplía la superficie de ataque con un formulario público. El administrador restablece la contraseña de un operador (FR-05), y la de un administrador se restablece con el script de recuperación, que corre en el servidor por Session Manager, con MFA (`docs/requisitos.md`, sección 1.3, decisión 3). Queda en el backlog del producto (decisión del Product Owner del 26 de noviembre de 2026). |

## 8. Glosario

Términos del dominio y su nombre en el código. El nombre de cada columna está en
el diccionario de datos (`docs/modelo-datos.md`, sección 4).

| Español | Código |
|---|---|
| Estadía | `stay` |
| Tarifa | `rate` |
| Tope legal | `legalCap` |
| Periodo de gracia | `gracePeriod` |
| Tope por periodo | `periodCap` |
| Descuento por tope | `capDiscount` |
| Cupos (de un tipo de vehículo) | `capacity` (atributo `spaces`) |
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
| Salud | `health` |

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
| 1.8 | 12 de noviembre de 2026 | Nombre visible del producto: RoloPark (ADR 0010). Los ejemplos de la sección 5 citan la tarea que los convirtió en pruebas, S2-09 (antes S1-08). (#71) |
| 1.9 | 14 de noviembre de 2026 | BR-18: tope por periodo configurable, con los bloques contados desde el ingreso. BR-11 incluye el tope y BR-14 su descuento. Ejemplos 7 a 13 con el esquema del parqueadero B y supuesto de BR-18 en la sección 6. El tope diario sale de la sección 7 y entran los turnos fijos por reloj. Actores y glosario con el tope. (#14) |
| 1.10 | 19 de noviembre de 2026 | BR-19: cupos por tipo de vehículo, calculados con las estadías activas, con el ingreso rechazado cuando no quedan. Ejemplos 14 a 20 y supuesto de BR-19 en la sección 6. Actores y glosario con los cupos. (#110) |
| 1.11 | 22 de noviembre de 2026 | BR-19: corregir el tipo de un vehículo que ya está dentro no se rechaza por cupos. Ejemplos 21 a 24 de la corrección de una estadía activa (BR-17). (#116) |
| 1.12 | 22 de noviembre de 2026 | Ejemplos 25 a 27 de la anulación sin reemplazo de una estadía activa o cerrada (BR-12). (#121) |
| 1.13 | 26 de noviembre de 2026 | Sección 7: la recuperación de contraseña por correo sigue fuera del alcance y queda en el backlog del producto; la contraseña de un administrador se restablece con el script de recuperación. (#131) |

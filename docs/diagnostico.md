# Diagnóstico exploratorio

| Campo | Valor |
|---|---|
| Proyecto | RoloPark — Sistema de Gestión de Parqueaderos |
| Tarea | S3-01 (#45) |
| Versión | 1.0 — 14 de noviembre de 2026 |

Este documento recoge el diagnóstico exploratorio que se hizo el 23 y el 24 de
octubre de 2026 en cuatro parqueaderos de Bogotá, presentado en el Anexo D de la
Entrega 1 del trabajo de grado, cuando el producto todavía se llamaba ParkApp.
Los requisitos se trazan a él (`docs/requisitos.md`, sección 5.3).

Como el repositorio es público, esta versión no incluye las fotografías de los
avisos y del recibo, que están en el Anexo D de la Entrega 1, ni la ubicación
exacta de los parqueaderos. Ningún parqueadero se identifica por su nombre.

## 1. Método

El diagnóstico se hizo en cuatro parqueaderos públicos fuera de vía de Bogotá,
elegidos por conveniencia, con dos niveles de profundidad:

- **Entrevista (parqueaderos A y B).** El 24 de octubre de 2026 se visitaron dos
  parqueaderos de barrio de una sola sede, en el sur de la ciudad. En cada uno se
  entrevistó al empleado de turno con una planilla impresa de once preguntas, y
  durante la visita se diligenció una sección de observación.
- **Observación breve (parqueaderos C y D).** El 23 de octubre de 2026 se
  visitaron dos parqueaderos de empresas distintas, ambas con varias sedes, en el
  norte de la ciudad. En cada uno se observó el aviso de tarifas y se hicieron
  tres preguntas al personal: cómo se registra el vehículo, cómo se calcula el
  cobro y qué fallas se presentan.

Las preguntas de la planilla fueron las siguientes:

1. ¿Usted es el dueño, el administrador o trabaja aquí?
2. ¿Cuántos carros y motos caben? Más o menos, ¿cuántos entran en un día?
3. Cuando entra un carro, ¿cómo lo registran? (tiquete, cuaderno, computador,
   celular)
4. ¿Qué anotan del vehículo? (placa, color, hora...)
5. ¿Cómo calculan lo que se cobra? ¿Por minuto, por hora o por día? ¿A mano,
   con calculadora o con un sistema?
6. ¿Le entregan algún recibo al cliente? ¿Qué datos lleva?
7. ¿Qué hacen si un cliente pierde el tiquete?
8. ¿Alguna vez ha habido problemas con el cobro (cobrar de más o de menos, una
   placa mal anotada)? ¿Me cuenta un caso?
9. Si necesitara saber quién registró un carro la semana pasada, ¿podría
   saberlo?
10. Si tuviera un sistema en el celular o en el computador, ¿qué es lo que más le
    serviría?
11. ¿Le gustaría ver el sistema en noviembre y dar su opinión?

La sección de observación registra si hay aviso de tarifas, si la tarifa es por
minuto, por hora o por día, si el tiquete es escrito a mano o impreso, y si hay
un computador en la caseta. La planilla informa al entrevistado que la
información se usa solo con fines académicos y que no se publica el nombre del
parqueadero ni datos de los clientes. Por eso, los establecimientos se
identifican con letras, y no se registraron placas ni nombres de personas. Las
planillas diligenciadas se conservan y están disponibles para la asesora.

## 2. Hallazgos en los parqueaderos de barrio

| Aspecto (pregunta) | Parqueadero A | Parqueadero B |
|---|---|---|
| Persona entrevistada (1) | Empleado | Empleado |
| Capacidad (2) | 15 a 16 carros y 200 a 300 motos. Según el empleado, las motos entran y salen con frecuencia. | 100 carros. Solo recibe carros; no recibe motos ni bicicletas. |
| Registro del ingreso (3 y 4) | En un computador, con la placa y la hora de entrada. Las bicicletas se identifican por su color. | En un cuaderno, con la placa. Se observó que en el cuaderno también se anota la salida. |
| Cálculo del cobro (5) | Por minuto; lo calcula el sistema. | A mano, con calculadora. Según el empleado, casi no se cobra por hora: la mayoría de los cobros son por turno de día o de noche, de 12 horas. |
| Aviso de tarifas (observación) | Sí: $80 por minuto para carro y $50 para moto, con horario de domingo a domingo, de 4:00 a. m. a 12:00 a. m. | No hay aviso. Tarifas informadas por el empleado: $2.000 por hora y $11.000 por turno de día o de noche. |
| Recibo al cliente (6) | Impreso. Al ingreso, con la placa y la hora de entrada. A la salida, con la placa, el valor y la hora de entrada, pero sin la hora de salida, que queda en el sistema. | Escrito a mano, con número consecutivo, placa, fecha, hora de entrada y valor; no tiene campo para la hora de salida. Al respaldo trae condiciones impresas. |
| Tiquete perdido (7) | Multa de $5.000, además del cobro del tiempo. | Se piden los documentos del vehículo y no hay multa. Las condiciones impresas dicen: «Sin este recibo no entregamos el automóvil». |
| Problemas con el cobro (8) | Antes de entregar el recibo de salida se verifica la placa. Según el empleado, nunca ha habido una placa mal registrada; si ocurriera, el sistema permite corregirla y todo queda registrado. No mencionó restricciones sobre quién puede corregirla. | El recibo indica el intervalo de tiempo del servicio, y hay clientes que recogen el vehículo a otra hora y se niegan a pagar el tiempo adicional. Se llega a un arreglo para que el cliente pague al menos un turno de los que ocupó, por ejemplo el de noche. |
| Trazabilidad (9) | Los recibos quedan en el sistema y se pueden consultar. | Sí, con el registro del cuaderno. |
| Lo que más le serviría (10) | No sabe o no responde. | «En un computador tener el software de registro». |
| Demostración (11) | Aceptó ver el sistema; indicó que hay que hablar con la dueña. | Aceptó ver el sistema. |

Respuestas del empleado de turno de cada parqueadero, 24 de octubre de 2026,
registradas en la planilla de entrevista, y observaciones hechas durante la
visita. Los números entre paréntesis remiten a las preguntas de la sección 1.

## 3. Hallazgos en los parqueaderos de empresas

| Aspecto | Parqueadero C | Parqueadero D |
|---|---|---|
| Operador | Empresa de parqueaderos con varias sedes | Otra empresa de parqueaderos con varias sedes |
| Registro del vehículo | Tiquete al ingreso y a la salida | Tiquete al ingreso y a la salida |
| Cálculo del cobro | Lo hace un sistema | Lo hace un sistema |
| Fallas reportadas | Ninguna | Sin internet, el sistema se cae y el cobro se calcula a mano, en papel |
| Tarifa por minuto (carro, moto y bicicleta) | $253, $177 y gratis | $230, $130 y $10 |
| Frente a los topes de 2026 | Igual al tope con Sello Oro, para carro y para moto | Igual al tope general para carro; la de moto está por debajo del tope de $161 |
| Tarifa fija | $33.000 para carro y $20.000 para moto, por 12 horas | Tarifa especial de $23.500 y tarifa plena de $14.000 para moto, hasta 12 horas continuas; después se cobra por minuto |
| Tiquete perdido | Campo «Valor por pérdida de tarjeta o tiquete», con el valor tapado | Aviso «Cuidar su tiquete» con un valor de $10.000 |
| Redondeo publicado | «...al múltiplo de cincuenta pesos ($50) siguiente», con el resto de la leyenda tapado | No legible en la fotografía |

Datos observados en los avisos y reportados por el personal el 23 de octubre de
2026. Los topes de referencia son los de `docs/reglas-de-negocio.md`, sección 3.

## 4. Implicaciones para el diseño

| Hallazgo | Implicación para RoloPark | Referencia |
|---|---|---|
| Las disputas de B surgen cuando el cliente recoge el vehículo a otra hora, y se resuelven con un arreglo en el que paga al menos un turno. | El servidor asigna la hora de entrada y de salida, y el cobro se calcula con los minutos reales entre ambas: el valor sale del tiempo registrado y no de una negociación. | BR-05, BR-16 |
| Ni el recibo de B ni el recibo de salida de A muestran la hora de salida, y B no publica su tarifa. | El comprobante muestra la hora de entrada y de salida, los minutos cobrados y la tarifa aplicada, para que el cliente pueda verificar el cobro. | BR-14, FR-14 |
| B calcula a mano, y D vuelve al papel cuando se cae la conexión. | El cobro se calcula siempre en el servidor, con una función probada con los ejemplos de `docs/reglas-de-negocio.md`, sección 5. | BR-05 a BR-08, FR-13, NFR-20 |
| A verifica la placa antes de entregar el recibo de salida. | La salida muestra los datos del ingreso para que el operador los compare con el vehículo antes de confirmar. | BR-04, FR-12 |
| En A, el sistema permite corregir una placa, y el empleado no mencionó restricciones sobre quién puede hacerlo. | Solo el administrador corrige, con un motivo, y la corrección se hace por reemplazo, sin borrar el registro original. | BR-17, FR-21 |
| B pide los documentos del vehículo y no cobra multa por el tiquete perdido; A cobra $5.000 y D publica $10.000. | La pérdida del tiquete no genera recargo. La regla se mantiene y se validará en la visita (sección 6). | BR-13 |
| D depende de la conexión, igual que una aplicación web. | La operación sin internet se declara como limitación y queda en el backlog del producto. | #54 |
| B, C y D cobran por periodos de hasta 12 horas; B cobra $11.000 por turno, muy por debajo de los $165.600 que costarían 720 minutos al tope general de $230. | El tope por periodo, configurable (12 horas para B), pasó a ser Must y primera tarea del Sprint 3, por la retroalimentación de la Entrega 1. Permite configurar el esquema de B dentro de la norma: cobro por minuto con el valor del turno como máximo de cada periodo. | #14 |
| C cobra exactamente el tope con Sello Oro. A, C y D atienden bicicletas, y A las identifica por su color porque no tienen placa. | El tope legal distingue la condición de Sello Oro. Las bicicletas quedan fuera del alcance, porque el registro se identifica por la placa. | BR-15; `docs/reglas-de-negocio.md`, sección 7 |

## 5. Limitaciones

El diagnóstico es exploratorio y tiene tres límites. Primero, son cuatro
parqueaderos elegidos por conveniencia y no una muestra, por lo que no permite
estimar qué proporción de los parqueaderos de Bogotá opera a mano. Segundo, en
todos respondió el personal de turno, no los dueños ni los administradores.
Tercero, las visitas fueron cortas: en C y D se hicieron solo tres preguntas, y
en ningún caso se tuvo acceso a registros internos.

## 6. Validación prevista

Estos límites se atienden con una visita a los cuatro parqueaderos después de la
Entrega 2 (#53). La demostración del Sprint 2 a los evaluadores fue la
aplicación funcionando en https://rolopark.com; la visita es la validación con
los usuarios.

- **Forma:** se presenta como una prueba académica de testeo y retroalimentación,
  no como una venta. Basta con los empleados; no hace falta contactar a los
  dueños.
- **Tareas que se prueban,** desde un celular en https://rolopark.com: registrar
  un ingreso, ver los vehículos dentro, registrar la salida, y ver el cobro y el
  comprobante. Se usan placas de prueba reconocibles, porque ningún registro se
  borra (RI-13).
- **Planilla:** lo que se mostró, las observaciones, los cambios pedidos y la
  decisión sobre cada cambio y su destino (Sprint 3, backlog del producto o
  descartado, con su razón), sin nombres de personas ni de negocios. El dueño del
  producto decide cada cambio, y cada cambio aprobado se convierte en una tarea
  del backlog.
- **Criterio de utilidad para B:** el sistema se considera útil para B si su
  empleado confirma que, con una tarifa por minuto y el valor del turno como
  tope de cada periodo de 12 horas (#14), el cobro de un turno y el de una
  estadía corta coinciden con su forma de cobrar, y que podría registrar sus
  vehículos con la aplicación. Si pide otro esquema, se registra como un cambio
  solicitado, con su decisión y su destino.

## 7. Historial de cambios

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 14 de noviembre de 2026 | Versión inicial, tomada del Anexo D de la Entrega 1, sin fotografías ni ubicación exacta. S3-01 (#45) |

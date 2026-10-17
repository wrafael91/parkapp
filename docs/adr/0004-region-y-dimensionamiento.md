# ADR 0004: Región us-east-1 con recursos de tamaño mínimo

- **Estado:** aceptada
- **Fecha:** 17 de octubre de 2026

## Contexto

El presupuesto es de USD 30 al mes (NFR-23) y la disponibilidad mínima, de 99 % (NFR-16), con unos 20 usuarios concurrentes (NFR-13). AWS no tiene región en Colombia. La Ley 1581 de 2012 restringe la transferencia de datos personales, como nombres, correos y placas, a países sin un nivel adecuado de protección. La Superintendencia de Industria y Comercio incluye a Estados Unidos en su lista de países adecuados (Circular Externa 005 de 2017).

## Decisión

El sistema se despliega en us-east-1 (Norte de Virginia), con una instancia EC2 `t4g.micro` (2 vCPU y 1 GB de memoria, más 1 GB de intercambio) y una base de datos RDS `db.t4g.micro` en una sola zona, con 20 GB gp3. Los dos recursos quedan en la misma zona, us-east-1a.

## Alternativas consideradas

- **São Paulo (sa-east-1):** queda más cerca geográficamente, pero es más cara, y Brasil no figura en la lista de la SIC.
- **EC2 `t4g.small` (2 GB):** con ella el total pasaría de USD 30 al mes.
- **RDS en varias zonas:** duplica el costo de la base de datos. Con una sola zona, las garantías de AWS (99,5 % para EC2 y 99,5 % para RDS) dan en conjunto cerca del 99 % que pide NFR-16.
- **PostgreSQL instalado en la misma instancia:** ahorraría unos USD 14 al mes, pero se perderían los respaldos automáticos con recuperación a un punto en el tiempo (NFR-18) y el aislamiento de la base de datos en una red privada. Además, el anteproyecto compromete RDS.

## Consecuencias

- El costo estimado es de USD 24,40 al mes (sección 6.8).
- Con 1 GB de memoria, la aplicación web se compila en GitHub Actions y no en el servidor.
- Las instancias t4g acumulan créditos de CPU mientras están en reposo y los gastan en los picos. Por defecto quedan en modo ilimitado: si la CPU se mantiene alta mucho tiempo, por ejemplo en la prueba de carga de NFR-13, AWS cobra el excedente. Se revisa en el Sprint 3.
- La disponibilidad queda justa en el mínimo garantizado (sección 6.7).
- Escalar significa cambiar el tipo de instancia, con unos minutos de interrupción.
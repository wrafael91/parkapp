# ADR 0002: Aplicación web y API en el mismo origen

- **Estado:** aceptada
- **Fecha:** 14 de octubre de 2026

## Contexto

La aplicación web (React) consume la API REST. La comunicación debe ser solo
por HTTPS (NFR-09), la sesión viaja en una cookie (ADR 0003) y el presupuesto
es de USD 30 al mes (NFR-23).

## Decisión

Nginx, en la misma instancia EC2 que la API, sirve los archivos compilados de la
aplicación web y reenvía las rutas `/api` a la API. Todo el sistema usa un solo
dominio y un solo certificado TLS.

## Alternativas consideradas

- **Aplicación web en S3 y CloudFront, con la API en otro dominio:** una red de
  distribución de contenido no aporta nada a pocos usuarios en un solo sitio.
  Además, exige CORS y cookies entre dominios (`SameSite=None`), lo que debilita
  la protección contra CSRF.
- **Balanceador de carga de AWS para terminar TLS:** tiene un costo fijo por
  hora que consumiría buena parte del presupuesto, para un sistema con una sola
  instancia.

## Consecuencias

- No se necesita CORS, la cookie de sesión puede ser `SameSite=Strict` y se
  administra un solo certificado.
- La instancia EC2 es un punto único de falla para todo el sistema. Se acepta
  dentro de la meta de disponibilidad del 99 % (NFR-16).
- El certificado TLS requiere un dominio propio, que se define en la vista de
  despliegue.
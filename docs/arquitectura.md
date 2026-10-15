# Arquitectura

| Campo | Valor |
|---|---|
| Proyecto | ParkApp — Sistema de Gestión de Parqueaderos |
| Tarea | S1-06 (#7) |
| Versión | 0.1 — 14 de octubre de 2026 (en construcción) |

Este documento describe la arquitectura de ParkApp con el modelo C4 (contexto,
contenedores y componentes) y una vista de despliegue en AWS. Las decisiones
importantes se registran como ADR (registros de decisiones de arquitectura) en
`docs/adr/`.

## 1. Requisitos que determinan la arquitectura

| Requisito | Qué exige de la arquitectura |
|---|---|
| Un solo parqueadero y 20 usuarios concurrentes (NFR-13) | Una escala pequeña, que no justifica distribuir el sistema. |
| Revocación inmediata de sesiones (NFR-04) | El servidor consulta el estado de la sesión en cada petición. |
| Horas asignadas por el servidor (BR-16) | Toda regla de negocio y todo cálculo ocurren en el backend; el frontend solo presenta. |
| Autorización y validación en el servidor (NFR-05, NFR-06) | La API no confía en el cliente: verifica el rol y valida cada entrada. |
| Solo HTTPS (NFR-09) | El sistema termina TLS en su borde de entrada. |
| Integridad y trazabilidad (RI-01 a RI-18, NFR-12) | Las reglas críticas se cumplen en la base de datos, además de en la API. |
| Disponibilidad del 99 % (NFR-16) | Reinicio automático y respaldos; no se requiere alta disponibilidad en varias zonas. |
| Costo máximo de USD 30 al mes (NFR-23) | Pocos servicios administrados, y de bajo costo. |

## 2. Estilo arquitectónico

ParkApp es un sistema cliente-servidor de tres niveles: una aplicación web de
una sola página (SPA) en React, que corre en el navegador; una API REST en
Node.js con Express y Prisma; y una base de datos PostgreSQL.

- La API es un **monolito modular por capas** (ADR 0001).
- La aplicación web y la API se sirven desde el **mismo origen** (ADR 0002).
- La sesión usa un **token aleatorio en una cookie `HttpOnly`** (ADR 0003).

## 3. Diagrama de contexto (C4, nivel 1)

```mermaid
flowchart TB
    operador["<b>Operador</b><br/>[Persona]<br/>Registra ingresos y salidas"]
    admin["<b>Administrador</b><br/>[Persona]<br/>Configura tarifas, gestiona cuentas,<br/>anula registros y consulta la bitácora"]
    cliente["<b>Cliente</b><br/>[Persona]<br/>Conductor del vehículo"]
    mantenedor["<b>Mantenedor de la plataforma</b><br/>[Persona]<br/>Actualiza el tope legal (BR-15)"]
    parkapp["<b>ParkApp</b><br/>[Sistema]<br/>Registro de vehículos y cobro del parqueo"]
    github["<b>GitHub</b><br/>[Sistema externo]<br/>Código, migraciones e integración continua"]

    operador -- "Usa, por HTTPS" --> parkapp
    admin -- "Usa, por HTTPS" --> parkapp
    operador -. "Entrega el comprobante" .-> cliente
    mantenedor -- "Publica migraciones versionadas" --> github
    github -- "Versiones que se despliegan" --> parkapp

    classDef persona fill:#08427b,stroke:#052e56,color:#ffffff
    classDef sistema fill:#1168bd,stroke:#0b4884,color:#ffffff
    classDef externo fill:#8a8a8a,stroke:#6b6b6b,color:#ffffff
    class operador,admin,cliente,mantenedor persona
    class parkapp sistema
    class github externo
```

El cliente no usa el sistema: recibe el comprobante del operador. El mantenedor
tampoco usa la aplicación: el tope legal solo cambia por migraciones versionadas
en el repositorio (BR-15).

## 4. Diagrama de contenedores (C4, nivel 2)

```mermaid
flowchart TB
    usuario["<b>Operador o Administrador</b><br/>[Persona]"]

    subgraph parkapp["ParkApp"]
        proxy["<b>Proxy inverso</b><br/>[Nginx]<br/>Termina TLS, sirve la aplicación web<br/>y reenvía /api a la API"]
        spa["<b>Aplicación web</b><br/>[React, SPA en el navegador]<br/>Formularios y consultas,<br/>sin reglas de negocio"]
        api["<b>API REST</b><br/>[Node.js, Express, Prisma]<br/>Reglas de negocio, cálculo del cobro,<br/>sesiones, roles, validación y auditoría"]
        db[("<b>Base de datos</b><br/>[PostgreSQL 16]<br/>Datos, restricciones RI-01 a RI-18<br/>y bitácora de auditoría")]
    end

    usuario -- "Abre la aplicación, por HTTPS" --> proxy
    proxy -- "Entrega los archivos estáticos" --> spa
    spa -- "JSON por HTTPS, mismo origen,<br/>cookie de sesión" --> proxy
    proxy -- "HTTP local, solo /api" --> api
    api -- "SQL con TLS" --> db

    classDef persona fill:#08427b,stroke:#052e56,color:#ffffff
    classDef contenedor fill:#438dd5,stroke:#2e6295,color:#ffffff
    classDef datos fill:#438dd5,stroke:#2e6295,color:#ffffff
    class usuario persona
    class proxy,spa,api contenedor
    class db datos
```

| Contenedor | Tecnología | Responsabilidad | Dónde corre |
|---|---|---|---|
| Proxy inverso | Nginx | Termina TLS, sirve la aplicación web, reenvía `/api` a la API y agrega encabezados de seguridad. | EC2 |
| Aplicación web | React | Interfaz de usuario. No contiene reglas de negocio ni cálculos (BR-16). | Navegador |
| API REST | Node.js, Express, Prisma | Reglas de negocio, cálculo del cobro, sesiones, control de acceso por rol, validación de entradas y auditoría. Un gestor de procesos la reinicia si falla (NFR-17). | EC2 |
| Base de datos | PostgreSQL 16 | Persistencia, restricciones de integridad y bitácora de auditoría. | Amazon RDS, en una subred privada |

## 5. Componentes de la API (C4, nivel 3)

Pendiente.

## 6. Despliegue en AWS

Pendiente.

## 7. Decisiones de arquitectura

| ADR | Decisión |
|---|---|
| [0001](adr/0001-monolito-modular.md) | Monolito modular por capas |
| [0002](adr/0002-mismo-origen.md) | Aplicación web y API en el mismo origen |
| [0003](adr/0003-sesion-en-cookie.md) | Sesión con token aleatorio en una cookie `HttpOnly` |
# ADR 0005: HTTPS con Let's Encrypt en Nginx y dominio en Cloudflare

- **Estado:** aceptada
- **Fecha:** 17 de octubre de 2026

## Contexto

NFR-09 exige HTTPS con TLS 1.2 o superior, y la cookie de sesión solo viaja por HTTPS (ADR 0003). Let's Encrypt no emite certificados para los nombres públicos que AWS asigna a las instancias, así que hace falta un dominio propio. La cuenta de AWS usa el plan gratuito, que se cierra a los 6 meses, y no es claro que ese plan permita registrar dominios en Route 53.

## Decisión

El dominio `.com` se registra en Cloudflare Registrar (USD 10,46 al año). El DNS queda en Cloudflare, con un registro A que apunta a la IP elástica y sin el proxy de Cloudflare. Nginx usa un certificado de Let's Encrypt, obtenido y renovado automáticamente con certbot. Solo acepta TLS 1.2 y 1.3, envía HSTS y usa el puerto 80 únicamente para redirigir a HTTPS y para la validación del certificado.

## Alternativas consideradas

- **Balanceador de carga con certificado de AWS Certificate Manager:** el certificado es gratuito, pero el balanceador tiene un costo fijo mensual alto para una sola instancia (ADR 0002).
- **Route 53 para el registro y el DNS:** dejaría todo dentro de AWS, pero el `.com` cuesta USD 16 al año y la zona de DNS, USD 0,50 al mes. Además, quizás el plan gratuito no lo permita, y el dominio quedaría atado a una cuenta que se cierra.
- **Proxy de Cloudflare:** agregaría protección contra ataques de denegación de servicio, pero cambia dónde termina TLS y cómo llega la IP del cliente. Queda como mejora futura.

## Consecuencias

- El certificado no cuesta nada. El dominio se paga una vez al año, fuera del presupuesto mensual de AWS, y sigue siendo del proyecto aunque se cierre la cuenta.
- El puerto 80 queda abierto, solo para redirección y validación.
- Si la renovación automática falla, el certificado vence y el sitio deja de funcionar. La renovación se prueba con `certbot renew --dry-run`, y el monitoreo del Sprint 3 alerta si el sitio deja de responder.
- NFR-09 se verifica con un escaneo TLS externo.

## Actualización del 14 de noviembre de 2026

El dominio es `rolopark.com`, registrado el 1 de noviembre de 2026 por USD 11,17 al año, y no un `.com` de USD 10,46: `parkapp.com` estaba ocupado. El porqué del nombre está en el ADR 0010.

La implementación (S2-06) agregó controles que esta decisión no tenía, con el criterio de exponer el sistema lo menos posible:

- Un registro CAA que solo autoriza a Let's Encrypt. Para que Cloudflare no agregue sus propias autoridades, su Universal SSL está desactivado; si algún día se activa el proxy de Cloudflare, hay que volver a activarlo.
- DNSSEC activo.
- Intercambio de llaves poscuántico (`X25519MLKEM768`), HSTS de dos años sin `preload` y sin OCSP stapling.
- Rechazo de las peticiones por IP o con un nombre desconocido.
- Renovación con el temporizador `certbot-renew.timer`, que venía desactivado, y un hook que recarga Nginx. Let's Encrypt ya no envía avisos de vencimiento, así que la vigilancia del certificado queda en el monitoreo del Sprint 3.

El sitio obtuvo A+ en SSL Labs. La decisión no cambia; la configuración está en `infra/nginx/` y en `docs/arquitectura.md`, secciones 6.2 y 6.3.

// Shared by the k6 scripts of the load test (S3-13, #127): the address of the test
// API, the Origin check (docs/modelo-amenazas.md, 7.3) and the operator sessions.
import http from "k6/http";
import { b64encode } from "k6/encoding";
import { randomBytes } from "k6/crypto";
import { fail } from "k6";

// The second API process on the server, connected to the restored instance
// (#126). Never production: README, "Ambiente".
export const BASE = __ENV.RP_BASE || "http://127.0.0.1:3001";

// The API only accepts state-changing requests from its own origin.
const ORIGIN = __ENV.RP_ORIGIN || "https://rolopark.com";

// The session cookie has Secure, so k6 does not send it back over http:// by
// itself; every request carries it in the Cookie header instead.
export function headers(session) {
  return { Cookie: `sesion=${session}`, Origin: ORIGIN, "Content-Type": "application/json" };
}

function signIn(correo, contrasena) {
  const res = http.post(`${BASE}/api/sesion`, JSON.stringify({ correo, contrasena }), {
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    tags: { fase: "preparacion" },
  });
  const cookie = res.cookies.sesion && res.cookies.sesion[0];
  if (res.status !== 200 || !cookie) {
    fail(`No se pudo iniciar sesión con ${correo}: HTTP ${res.status}`);
  }
  return cookie.value;
}

// The load administrator, created with create-admin.js only in the restored
// instance, creates one operator account per virtual user (US-02), with a random
// password that only lives in memory, and signs each one in. Every virtual user is
// one operator with its own session, as at a real parking lot.
export function operatorSessions(count) {
  const correo = __ENV.RP_ADMIN_CORREO;
  const clave = __ENV.RP_ADMIN_CLAVE;
  if (!correo || !clave) {
    fail("Faltan RP_ADMIN_CORREO y RP_ADMIN_CLAVE (README, paso de la cuenta de carga).");
  }
  const admin = signIn(correo, clave);
  const run = Date.now().toString(36);
  const sessions = [];
  for (let i = 1; i <= count; i += 1) {
    const operator = `carga.${run}.op${i}@rolopark.test`;
    const password = b64encode(randomBytes(24));
    const res = http.post(
      `${BASE}/api/usuarios`,
      JSON.stringify({ nombre: `Operador de carga ${i}`, correo: operator, contrasena: password }),
      { headers: headers(admin), tags: { fase: "preparacion" } },
    );
    if (res.status !== 201) {
      fail(`No se pudo crear ${operator}: HTTP ${res.status} ${res.body}`);
    }
    sessions.push(signIn(operator, password));
  }
  return sessions;
}

// The session of this virtual user.
export function mySession(sessions) {
  return sessions[(__VU - 1) % sessions.length];
}

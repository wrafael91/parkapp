import { useEffect, useState } from "react";

// GET, POST and DELETE /api/sesion (ADR 0008), with a relative URL and the
// default fetch: the page and the API share the origin, so the browser sends
// the session cookie and the Origin header by itself, without CORS or
// credentials: "include" (ADR 0002; docs/modelo-amenazas.md, 7.3).
const SESSION_URL = "/api/sesion";

// The part of the API's usuario that the page shows (ADR 0008).
type Usuario = { nombre: string };

type Session =
  | { status: "checking" }
  | { status: "unavailable" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: Usuario };

export default function App() {
  const [session, setSession] = useState<Session>({ status: "checking" });

  useEffect(() => {
    // Is there an active session? GET /api/sesion answers 200 or 401.
    const controller = new AbortController();
    fetch(SESSION_URL, { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) {
          const body: { usuario: Usuario } = await response.json();
          setSession({ status: "signedIn", user: body.usuario });
        } else {
          setSession({ status: response.status === 401 ? "signedOut" : "unavailable" });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSession({ status: "unavailable" });
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>RoloPark</h1>
      {session.status === "checking" && <p>Comprobando la sesión…</p>}
      {session.status === "unavailable" && <p>No se pudo conectar con el servidor.</p>}
      {session.status === "signedOut" && <SignInForm />}
      {session.status === "signedIn" && <SignedIn user={session.user} />}
    </main>
  );
}

function SignInForm() {
  return (
    <form>
      <label>
        Correo
        <input name="correo" type="email" autoComplete="username" required />
      </label>
      <label>
        Contraseña
        <input name="contrasena" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit">Iniciar sesión</button>
    </form>
  );
}

function SignedIn({ user }: { user: Usuario }) {
  return (
    <>
      <p>Sesión iniciada: {user.nombre}</p>
      <button type="button">Cerrar sesión</button>
    </>
  );
}

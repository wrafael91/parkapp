import { useEffect, useState, type SubmitEvent } from "react";
import Stays from "./Stays.tsx";

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
      {session.status === "signedOut" && (
        <SignInForm onSignedIn={(user) => setSession({ status: "signedIn", user })} />
      )}
      {session.status === "signedIn" && (
        <SignedIn user={session.user} onSignedOut={() => setSession({ status: "signedOut" })} />
      )}
    </main>
  );
}

const SIGN_IN_FAILED = "No se pudo iniciar sesión. Intenta de nuevo.";

function SignInForm({ onSignedIn }: { onSignedIn: (user: Usuario) => void }) {
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // null when the server cannot be reached.
    const response = await fetch(SESSION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: form.get("correo"), contrasena: form.get("contrasena") }),
    }).catch(() => null);
    if (response?.ok) {
      const body: { usuario: Usuario } = await response.json();
      onSignedIn(body.usuario);
      return;
    }
    // The API gives the same 401 for every rejected sign-in (US-01).
    setError(response?.status === 401 ? "Correo o contraseña incorrectos." : SIGN_IN_FAILED);
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Correo
        <input name="correo" type="email" autoComplete="username" required />
      </label>
      <label>
        Contraseña
        <input name="contrasena" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit">Iniciar sesión</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function SignedIn({ user, onSignedOut }: { user: Usuario; onSignedOut: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    // null when the server cannot be reached.
    const response = await fetch(SESSION_URL, { method: "DELETE" }).catch(() => null);
    if (response?.ok) {
      onSignedOut();
      return;
    }
    // The session may still be active, so the page keeps showing it.
    setError("No se pudo cerrar la sesión. Intenta de nuevo.");
  }

  return (
    <>
      <p>Sesión iniciada: {user.nombre}</p>
      <button type="button" onClick={handleSignOut}>
        Cerrar sesión
      </button>
      {error && <p role="alert">{error}</p>}
      <Stays onSessionEnded={onSignedOut} />
    </>
  );
}

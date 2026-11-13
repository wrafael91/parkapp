import { useEffect, useState, type ReactNode, type SubmitEvent } from "react";
import Rates from "./Rates.tsx";
import Stays from "./Stays.tsx";

// GET, POST and DELETE /api/sesion (ADR 0008), with a relative URL and the
// default fetch: the page and the API share the origin, so the browser sends
// the session cookie and the Origin header by itself, without CORS or
// credentials: "include" (ADR 0002; docs/modelo-amenazas.md, 7.3).
const SESSION_URL = "/api/sesion";

// The part of the API's usuario that the page uses (ADR 0008).
type Usuario = { nombre: string; rol: "ADMINISTRADOR" | "OPERADOR" };

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

  if (session.status === "signedIn") {
    return <SignedIn user={session.user} onSignedOut={() => setSession({ status: "signedOut" })} />;
  }

  return (
    <>
      <TopBar />
      <main className="page page-centered">
        {session.status === "checking" && <p className="muted">Comprobando la sesión…</p>}
        {session.status === "unavailable" && (
          <p className="alert">No se pudo conectar con el servidor.</p>
        )}
        {session.status === "signedOut" && (
          <SignInForm onSignedIn={(user) => setSession({ status: "signedIn", user })} />
        )}
      </main>
    </>
  );
}

// The bar on top of every screen: the name of the product, the sections an
// administrator can open and, when there is a session, who signed in and the
// button to sign out.
function TopBar({ nav, children }: { nav?: ReactNode; children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-start">
        <h1 className="brand">
          <span className="brand-mark" aria-hidden="true">
            RP
          </span>
          RoloPark
        </h1>
        {nav}
      </div>
      {children && <div className="topbar-session">{children}</div>}
    </header>
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
    <section className="card sign-in">
      <h2>Iniciar sesión</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Correo
          <input name="correo" type="email" autoComplete="username" required />
        </label>
        <label>
          Contraseña
          <input name="contrasena" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit" className="button-primary">
          Iniciar sesión
        </button>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

type Section = "operation" | "rates";

function SignedIn({ user, onSignedOut }: { user: Usuario; onSignedOut: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("operation");

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
      <TopBar
        nav={
          // Matrix 1.2: only an administrator configures the rates, so an
          // operator sees no sections. The API checks the role anyway (NFR-05).
          user.rol === "ADMINISTRADOR" && (
            <nav className="topbar-nav" aria-label="Secciones">
              <SectionButton current={section} section="operation" onSelect={setSection}>
                Operación
              </SectionButton>
              <SectionButton current={section} section="rates" onSelect={setSection}>
                Tarifas
              </SectionButton>
            </nav>
          )
        }
      >
        <p>Sesión iniciada: {user.nombre}</p>
        <button type="button" className="button-on-dark" onClick={handleSignOut}>
          Cerrar sesión
        </button>
      </TopBar>
      <main className="page">
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {section === "rates" ? (
          <Rates onSessionEnded={onSignedOut} />
        ) : (
          <Stays onSessionEnded={onSignedOut} />
        )}
      </main>
    </>
  );
}

function SectionButton({
  current,
  section,
  onSelect,
  children,
}: {
  current: Section;
  section: Section;
  onSelect: (section: Section) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={current === section ? "page" : undefined}
      onClick={() => onSelect(section)}
    >
      {children}
    </button>
  );
}

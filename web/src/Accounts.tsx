import { useEffect, useState, type SubmitEvent } from "react";
import { formatDateTime } from "./stay.ts";

// GET and POST /api/usuarios (ADR 0008),
// with a relative URL and the default fetch, as in App.tsx: the browser sends
// the session cookie by itself (docs/modelo-amenazas.md, 7.3).
const USERS_URL = "/api/usuarios";

// An account as the API answers it (ADR 0008), without its password.
type Usuario = {
  id: number;
  nombre: string;
  correo: string;
  rol: "ADMINISTRADOR" | "OPERADOR";
  activa: boolean;
  creadaEn: string;
};

type List = { status: "loading" } | { status: "failed" } | { status: "loaded"; users: Usuario[] };

// A message under a card: an error in an alert, or what was done.
type Note = { kind: "error" | "saved"; text: string } | null;

const ROLES = { ADMINISTRADOR: "Administrador", OPERADOR: "Operador" };

// The accounts (US-02, US-03), for administrators only (matrix 1.2): the list,
// a form to create operator accounts, and deactivating or reactivating them.
// The server checks the role and every rule; a 401 goes back to sign in.
export default function Accounts({ onSessionEnded }: { onSessionEnded: () => void }) {
  const [list, setList] = useState<List>({ status: "loading" });
  const [createNote, setCreateNote] = useState<Note>(null);
  const [creating, setCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    // Loads once, when the screen appears.
    const controller = new AbortController();
    fetch(USERS_URL, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          onSessionEnded();
          return;
        }
        if (!response.ok) {
          setList({ status: "failed" });
          return;
        }
        const { usuarios }: { usuarios: Usuario[] } = await response.json();
        setList({ status: "loaded", users: usuarios });
      })
      .catch(() => {
        if (!controller.signal.aborted) setList({ status: "failed" });
      });
    return () => controller.abort();
    // Not a dependency, as in Stays.tsx: the first onSessionEnded is enough.
  }, []);

  function replace(user: Usuario) {
    setList((current) =>
      current.status === "loaded"
        ? {
            ...current,
            users: current.users.some((each) => each.id === user.id)
              ? current.users.map((each) => (each.id === user.id ? user : each))
              : [...current.users, user],
          }
        : current,
    );
  }

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setCreating(true);
    // null when the server cannot be reached.
    const response = await fetch(USERS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: form.get("nombre"),
        correo: form.get("correo"),
        contrasena: form.get("contrasena"),
      }),
    }).catch(() => null);
    setCreating(false);
    if (response?.ok) {
      const created: Usuario = await response.json();
      replace(created);
      formElement.reset();
      setShowPassword(false);
      setCreateNote({
        kind: "saved",
        text: `Cuenta creada: ${created.correo}. Entrégale la contraseña inicial en persona.`,
      });
      return;
    }
    if (response?.status === 401) {
      onSessionEnded();
      return;
    }
    setCreateNote({ kind: "error", text: createError(response?.status) });
  }

  return (
    <div className="operation">
      <section className="card">
        <h2>Crear cuenta de operador</h2>
        <form onSubmit={handleCreate}>
          <label>
            Nombre
            <input name="nombre" maxLength={100} autoComplete="off" required />
          </label>
          <label>
            Correo
            <input name="correo" type="email" maxLength={254} autoComplete="off" required />
          </label>
          <label>
            Contraseña inicial
            <input
              name="contrasena"
              type={showPassword ? "text" : "password"}
              maxLength={64}
              autoComplete="new-password"
              required
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(event) => setShowPassword(event.target.checked)}
            />
            Mostrar contraseña
          </label>
          <p className="muted">De 15 a 64 caracteres. Entrégasela al operador en persona.</p>
          <button type="submit" className="button-primary" disabled={creating}>
            Crear cuenta
          </button>
        </form>
        <NoteLine note={createNote} />
      </section>
      <section className="card">
        <h2>Cuentas</h2>
        {list.status === "loading" && <p className="muted">Cargando…</p>}
        {list.status === "failed" && (
          <p role="alert" className="alert">
            No se pudieron cargar las cuentas.
          </p>
        )}
        {list.status === "loaded" && (
          // On a phone the table scrolls inside its card, not the whole page.
          <div className="table-scroll">
            <table className="stays">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Creada</th>
                  <th className="column-exit">Acción</th>
                </tr>
              </thead>
              <tbody>
                {list.users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.nombre}</td>
                    <td>{user.correo}</td>
                    <td>{ROLES[user.rol]}</td>
                    <td>{user.activa ? "Activa" : "Inactiva"}</td>
                    <td>
                      {/* The date in Bogotá, without the time, so the table fits beside the form. */}
                      <time dateTime={user.creadaEn}>
                        {formatDateTime(user.creadaEn).slice(0, 10)}
                      </time>
                    </td>
                    <td className="column-exit">
                      {/* Administrators are not deactivated from here (US-03). */}
                      {user.rol === "OPERADOR" && (
                        <button
                          type="button"
                          className="button-secondary"
                          aria-label={`${user.activa ? "Desactivar" : "Reactivar"} ${user.correo}`}
                        >
                          {user.activa ? "Desactivar" : "Reactivar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function NoteLine({ note }: { note: Note }) {
  if (note === null) return null;
  return note.kind === "error" ? (
    <p role="alert" className="alert">
      {note.text}
    </p>
  ) : (
    <p role="status" className="saved">
      {note.text}
    </p>
  );
}

// The page reads the API's status (ADR 0008, decision 6) and writes its own
// message.
function createError(status: number | undefined): string {
  switch (status) {
    case 400:
      return "Revisa los datos: el nombre de 1 a 100 caracteres, un correo válido y una contraseña de 15 a 64 caracteres.";
    case 403:
      return "Solo un administrador puede crear cuentas.";
    case 409:
      return "Ya existe una cuenta con ese correo.";
    default:
      return "No se pudo crear la cuenta. Intenta de nuevo.";
  }
}

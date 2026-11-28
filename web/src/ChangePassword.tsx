import { useState, type SubmitEvent } from "react";

// POST /api/sesion/contrasena (ADR 0008), with a relative URL and the default
// fetch, as in App.tsx: the browser sends the session cookie by itself
// (docs/modelo-amenazas.md, 7.3).
const CHANGE_URL = "/api/sesion/contrasena";

// The user of the session as the API answers it (ADR 0008).
type Usuario = {
  nombre: string;
  rol: "ADMINISTRADOR" | "OPERADOR";
  debeCambiarContrasena: boolean;
};

type Note = { kind: "error" | "saved"; text: string } | null;

// US-05: the signed-in user changes his own password. When someone else assigned
// it (RI-16), the change is mandatory and this is the only screen; the server
// rejects every other request until then. The server checks every rule; the
// page only checks that the new password was typed twice the same.
export default function ChangePassword({
  mandatory = false,
  onChanged,
  onSessionEnded,
}: {
  mandatory?: boolean;
  onChanged: (user: Usuario) => void;
  onSessionEnded: () => void;
}) {
  const [note, setNote] = useState<Note>(null);
  const [saving, setSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (form.get("nueva") !== form.get("confirmacion")) {
      setNote({ kind: "error", text: "Las contraseñas nuevas no coinciden." });
      return;
    }
    setSaving(true);
    // null when the server cannot be reached.
    const response = await fetch(CHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actual: form.get("actual"), nueva: form.get("nueva") }),
    }).catch(() => null);
    setSaving(false);
    if (response?.ok) {
      const { usuario }: { usuario: Usuario } = await response.json();
      formElement.reset();
      setShowPasswords(false);
      setNote({ kind: "saved", text: "Contraseña cambiada. Tus otras sesiones se cerraron." });
      onChanged(usuario);
      return;
    }
    if (response?.status === 401) {
      onSessionEnded();
      return;
    }
    const body = response === null ? null : await response.json().catch(() => null);
    setNote({ kind: "error", text: changeError(response?.status, body?.error?.codigo) });
  }

  return (
    <section className="card sign-in">
      <h2>Cambiar contraseña</h2>
      {mandatory && <p>Tu contraseña fue asignada por otra persona. Cámbiala para continuar.</p>}
      <form onSubmit={handleSubmit}>
        <label>
          Contraseña actual
          <input
            name="actual"
            type={showPasswords ? "text" : "password"}
            maxLength={64}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          Contraseña nueva
          <input
            name="nueva"
            type={showPasswords ? "text" : "password"}
            maxLength={64}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Repite la contraseña nueva
          <input
            name="confirmacion"
            type={showPasswords ? "text" : "password"}
            maxLength={64}
            autoComplete="new-password"
            required
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showPasswords}
            onChange={(event) => setShowPasswords(event.target.checked)}
          />
          Mostrar contraseñas
        </label>
        <p className="muted">De 15 a 64 caracteres, distinta de la actual.</p>
        <button type="submit" className="button-primary" disabled={saving}>
          Cambiar contraseña
        </button>
      </form>
      {note && (
        <p
          role={note.kind === "error" ? "alert" : "status"}
          className={note.kind === "error" ? "alert" : "saved"}
        >
          {note.text}
        </p>
      )}
    </section>
  );
}

// The page reads the API's error code (ADR 0008, decision 6) and writes its own
// message.
function changeError(status: number | undefined, codigo: string | undefined): string {
  switch (codigo) {
    case "CONTRASENA_ACTUAL_INCORRECTA":
      return "La contraseña actual no es correcta.";
    case "CONTRASENA_REPETIDA":
      return "La contraseña nueva debe ser distinta de la actual.";
  }
  return status === 400
    ? "La contraseña nueva debe tener de 15 a 64 caracteres."
    : "No se pudo cambiar la contraseña. Intenta de nuevo.";
}

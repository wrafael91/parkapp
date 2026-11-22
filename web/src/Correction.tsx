import { useState, type SubmitEvent } from "react";
import { formatEntryTime, goneMessage, type Estadia } from "./stay.ts";

// The replacement as POST /api/estadias/{id}/correccion answers it (ADR 0008):
// the stay as the list shows it, plus the id of the voided one.
export type Reemplazo = Estadia & { reemplazaA: number };

// The page reads the API's error code (ADR 0008, decision 6) and writes its own
// message. The form keeps what was typed.
function correctionError(codigo: string | undefined): string {
  switch (codigo) {
    // RI-02: the corrected plate cannot be active twice.
    case "PLACA_ACTIVA":
      return "La placa corregida ya tiene una estadía activa.";
    // BR-11: the new type takes its rate in force at the entry.
    case "SIN_TARIFA":
      return "No había tarifa para ese tipo de vehículo a la hora del ingreso.";
    case "SIN_CAMBIOS":
      return "La corrección no cambia ningún dato.";
    case "ENTRADA_INVALIDA":
      return "Revisa los datos: la placa de carro es como ABC123 y la de moto como ABC12D, y el motivo es obligatorio.";
    case "ACCESO_DENEGADO":
      return "Solo un administrador puede corregir un ingreso.";
    default:
      return "No se pudo guardar la corrección. Intenta de nuevo.";
  }
}

// The correction of an active stay (US-10, FR-21): the administrator corrects
// the plate, the type, the color or the brand, and writes the reason. The API
// voids the stay and creates its replacement with the same entry time (BR-12,
// BR-17), so the entry time is shown but cannot be sent (BR-16).
export default function Correction({
  stay,
  onCorrected,
  onGone,
  onClose,
  onSessionEnded,
}: {
  stay: Estadia;
  onCorrected: (replacement: Reemplazo) => void;
  onGone: (message: string) => void;
  onClose: () => void;
  onSessionEnded: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const marca = String(form.get("marca") ?? "");
    // The server normalizes the plate and checks the reason (FR-08). The buttons
    // stay disabled until the answer arrives. The default fetch, without
    // credentials (docs/modelo-amenazas.md, 7.3).
    setSending(true);
    // null when the server cannot be reached.
    const response = await fetch(`/api/estadias/${stay.id}/correccion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placa: form.get("placa"),
        tipoVehiculo: form.get("tipoVehiculo"),
        color: form.get("color"),
        marca: marca.trim() === "" ? null : marca,
        motivo: form.get("motivo"),
      }),
    }).catch(() => null);
    setSending(false);
    if (response?.ok) {
      onCorrected(await response.json());
      return;
    }
    if (response?.status === 401) {
      onSessionEnded();
      return;
    }
    const body: { error?: { codigo?: string } } | null = response
      ? await response.json().catch(() => null)
      : null;
    const codigo = body?.error?.codigo;
    // The vehicle left, or another administrator corrected it, meanwhile.
    const gone = goneMessage(codigo);
    if (gone) {
      onGone(gone);
      return;
    }
    // What was typed stays in the form, so it can be fixed and sent again.
    setError(correctionError(codigo));
  }

  return (
    <section className="card exit correction">
      <h2>Corregir ingreso</h2>
      <p className="muted">
        La estadía se anula y otra la reemplaza con los datos corregidos y la misma hora de ingreso.
      </p>
      <dl className="exit-data">
        <dt>Ingreso</dt>
        <dd>
          <time dateTime={stay.horaIngreso}>{formatEntryTime(stay.horaIngreso)}</time>
        </dd>
      </dl>
      <form onSubmit={handleSubmit}>
        <label>
          Placa
          <input
            name="placa"
            className="plate-input"
            required
            maxLength={20}
            defaultValue={stay.placa}
            autoComplete="off"
            autoCapitalize="characters"
          />
        </label>
        <label>
          Tipo de vehículo
          <select name="tipoVehiculo" defaultValue={stay.tipoVehiculo}>
            <option value="CARRO">Carro</option>
            <option value="MOTO">Moto</option>
          </select>
        </label>
        <label>
          Color
          <input
            name="color"
            required
            maxLength={30}
            defaultValue={stay.color}
            autoComplete="off"
          />
        </label>
        <label>
          Marca (opcional)
          <input name="marca" maxLength={40} defaultValue={stay.marca ?? ""} autoComplete="off" />
        </label>
        <label>
          Motivo
          <input name="motivo" required maxLength={200} autoComplete="off" />
        </label>
        <div className="actions">
          <button type="submit" className="button-primary" disabled={sending}>
            Guardar corrección
          </button>
          <button type="button" className="button-secondary" disabled={sending} onClick={onClose}>
            Cancelar
          </button>
        </div>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

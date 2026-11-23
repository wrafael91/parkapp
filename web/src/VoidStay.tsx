import { useState, type SubmitEvent } from "react";
import { formatDateTime, formatPesos, VEHICLE_TYPES, type HistoryStay } from "./stay.ts";

// "N.º 8 · $1.350", as the history shows a receipt.
function receiptText(receipt: { consecutivo: number; total: number }): string {
  return `N.º ${receipt.consecutivo} · ${formatPesos(receipt.total)}`;
}

// The void of an active or closed stay (FR-15, US-10). The administrator writes
// the reason; the server sets the state, the time and the user (BR-16), and keeps
// everything (BR-12). A closed stay keeps its receipt, which is void with it.
export default function VoidStay({
  stay,
  onVoided,
  onClose,
}: {
  stay: HistoryStay;
  onVoided: (voided: HistoryStay) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // With the state the panel showed: if the stay left or was corrected since,
    // the API voids nothing (FR-15). The buttons stay disabled until the answer
    // arrives. The default fetch, without credentials (docs/modelo-amenazas.md, 7.3).
    setSending(true);
    // null when the server cannot be reached.
    const response = await fetch(`/api/estadias/${stay.id}/anulacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: form.get("motivo"), estado: stay.estado }),
    }).catch(() => null);
    setSending(false);
    if (response?.ok) {
      onVoided(await response.json());
      return;
    }
    // The reason stays in the form, so it can be sent again.
    setError("No se pudo anular la estadía. Intenta de nuevo.");
  }

  return (
    <section className="card exit correction">
      <h2>Anular estadía</h2>
      <p className="muted">
        La estadía queda anulada con tu usuario, la hora y el motivo. No se borra: sigue en el
        historial.
      </p>
      <dl className="exit-data">
        <dt>Placa</dt>
        <dd>
          <span className="plate">{stay.placa}</span>
        </dd>
        <dt>Tipo</dt>
        <dd>{VEHICLE_TYPES[stay.tipoVehiculo]}</dd>
        <dt>Ingreso</dt>
        <dd>
          <time dateTime={stay.horaIngreso}>{formatDateTime(stay.horaIngreso)}</time>
        </dd>
        {stay.horaSalida !== null && (
          <>
            <dt>Salida</dt>
            <dd>
              <time dateTime={stay.horaSalida}>{formatDateTime(stay.horaSalida)}</time>
            </dd>
          </>
        )}
        {stay.comprobante !== null && (
          <>
            <dt>Comprobante</dt>
            <dd>{receiptText(stay.comprobante)}</dd>
          </>
        )}
      </dl>
      {stay.comprobante !== null && (
        <p className="void-receipt">
          El comprobante N.º {stay.comprobante.consecutivo} por{" "}
          {formatPesos(stay.comprobante.total)} también queda anulado.
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <label>
          Motivo
          <input name="motivo" required maxLength={200} autoComplete="off" />
        </label>
        <div className="actions">
          <button type="submit" className="button-primary" disabled={sending}>
            Anular estadía
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

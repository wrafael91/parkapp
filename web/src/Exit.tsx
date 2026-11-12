import { useState } from "react";
import { formatEntryTime, VEHICLE_TYPES, type Estadia } from "./stay.ts";

// The exit of one stay (US-08, US-09): the entry data, to check that it
// matches the vehicle that leaves (BR-04).
export default function Exit({
  stay,
  onExited,
  onClose,
}: {
  stay: Estadia;
  onExited: () => void;
  onClose: () => void;
}) {
  const [sending, setSending] = useState(false);

  async function confirmExit() {
    // No body: the server sets the exit time and the user, and calculates the
    // fee (BR-16, BR-11). The default fetch, without credentials (7.3). The
    // buttons stay disabled until the answer arrives.
    setSending(true);
    // null when the server cannot be reached.
    const response = await fetch(`/api/estadias/${stay.id}/salida`, { method: "POST" }).catch(
      () => null,
    );
    setSending(false);
    if (response?.ok) {
      onExited();
      onClose();
    }
  }

  return (
    <section>
      <h2>Verificar salida</h2>
      <p>Revisa que los datos del ingreso coincidan con el vehículo que sale.</p>
      <dl>
        <dt>Placa</dt>
        <dd>{stay.placa}</dd>
        <dt>Tipo</dt>
        <dd>{VEHICLE_TYPES[stay.tipoVehiculo]}</dd>
        <dt>Color</dt>
        <dd>{stay.color}</dd>
        <dt>Marca</dt>
        <dd>{stay.marca ?? "—"}</dd>
        <dt>Ingreso</dt>
        <dd>
          <time dateTime={stay.horaIngreso}>{formatEntryTime(stay.horaIngreso)}</time>
        </dd>
      </dl>
      <button type="button" disabled={sending} onClick={confirmExit}>
        Confirmar salida
      </button>
      <button type="button" disabled={sending} onClick={onClose}>
        Cancelar
      </button>
    </section>
  );
}

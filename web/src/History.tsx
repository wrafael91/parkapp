import { useEffect, useState } from "react";
import {
  bogotaToday,
  formatDateTime,
  formatPesos,
  STAY_STATES,
  VEHICLE_TYPES,
  type HistoryStay,
} from "./stay.ts";

// GET /api/estadias with the history filters (ADR 0008), with a relative URL and
// the default fetch, as in App.tsx (docs/modelo-amenazas.md, 7.3).
const STAYS_URL = "/api/estadias";

type Result =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; stays: HistoryStay[]; hayMas: boolean };

// The history (US-13, first part): the stays of a day in Bogotá, part of a plate
// or both, for operators and administrators (requirements 1.3, decision 5). It
// only reads: nothing here changes or exports a stay.
export default function History({ onSessionEnded }: { onSessionEnded: () => void }) {
  // Today in Bogotá, whatever the time zone of the computer.
  const [fecha, setFecha] = useState(() => bogotaToday(new Date()));
  const [result, setResult] = useState<Result>({ status: "loading" });

  async function search(day: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ fecha: day });
    setResult({ status: "loading" });
    // null when the server cannot be reached or the screen closed.
    const response = await fetch(`${STAYS_URL}?${query}`, { signal }).catch(() => null);
    if (signal?.aborted) return;
    if (response?.ok) {
      const body: { estadias: HistoryStay[]; hayMas: boolean } = await response.json();
      setResult({ status: "loaded", stays: body.estadias, hayMas: body.hayMas });
    } else if (response?.status === 401) {
      onSessionEnded();
    } else {
      setResult({ status: "failed" });
    }
  }

  useEffect(() => {
    // The stays that entered today, when the screen appears.
    const controller = new AbortController();
    search(fecha, controller.signal);
    return () => controller.abort();
    // Only once: later searches come from the form.
  }, []);

  return (
    <section className="card">
      <h2>Historial</h2>
      <form className="history-filters">
        <div className="history-day">
          <label>
            Día
            <input type="date" value={fecha} onChange={(event) => setFecha(event.target.value)} />
          </label>
        </div>
      </form>
      {result.status === "loading" && <p className="muted">Cargando…</p>}
      {result.status === "failed" && (
        <p role="alert" className="alert">
          No se pudo cargar el historial.
        </p>
      )}
      {result.status === "loaded" && result.stays.length === 0 && (
        <p className="muted">No hay estadías con esos filtros.</p>
      )}
      {result.status === "loaded" && result.hayMas && (
        <p className="muted">
          Se muestran las 500 estadías más recientes. Escribe una placa o elige un tipo para ver las
          demás.
        </p>
      )}
      {result.status === "loaded" && result.stays.length > 0 && (
        // On a phone the table scrolls inside its card, not the whole page.
        <div className="table-scroll">
          <table className="stays">
            <thead>
              <tr>
                <th>Placa</th>
                <th>Tipo</th>
                <th>Color</th>
                <th>Marca</th>
                <th>Ingreso</th>
                <th>Salida</th>
                <th>Estado</th>
                <th>Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {result.stays.map((stay) => (
                <tr key={stay.id}>
                  <td>
                    <span className="plate">{stay.placa}</span>
                  </td>
                  <td>{VEHICLE_TYPES[stay.tipoVehiculo]}</td>
                  <td>{stay.color}</td>
                  <td>{stay.marca ?? "—"}</td>
                  <td>
                    <time dateTime={stay.horaIngreso}>{formatDateTime(stay.horaIngreso)}</time>
                  </td>
                  <td>
                    {stay.horaSalida === null ? (
                      "—"
                    ) : (
                      <time dateTime={stay.horaSalida}>{formatDateTime(stay.horaSalida)}</time>
                    )}
                  </td>
                  <td>{STAY_STATES[stay.estado]}</td>
                  <td>
                    {/* A voided stay has no valid receipt (BR-12). */}
                    {stay.comprobante === null || stay.estado === "ANULADA"
                      ? "—"
                      : `N.º ${stay.comprobante.consecutivo} · ${formatPesos(stay.comprobante.total)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

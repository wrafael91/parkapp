import { useEffect, useState, type SubmitEvent } from "react";
import {
  bogotaToday,
  formatDateTime,
  formatPesos,
  normalizePlateSearch,
  STAY_STATES,
  VEHICLE_TYPES,
  type HistoryStay,
} from "./stay.ts";
import VoidStay from "./VoidStay.tsx";

// GET /api/estadias with the history filters (ADR 0008), with a relative URL and
// the default fetch, as in App.tsx (docs/modelo-amenazas.md, 7.3).
const STAYS_URL = "/api/estadias";

type Filters = { fecha: string; placa: string; tipoVehiculo: string };

type Result =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "rejected"; message: string }
  | { status: "loaded"; stays: HistoryStay[]; hayMas: boolean };

// The history (US-13, first part): the stays of a day in Bogotá, part of a plate
// or both, for operators and administrators (requirements 1.3, decision 5).
// Nothing here exports a stay. canVoid is true for an administrator, who can also
// void an active or closed stay (FR-15).
export default function History({
  onSessionEnded,
  canVoid = false,
}: {
  onSessionEnded: () => void;
  canVoid?: boolean;
}) {
  // Today in Bogotá, whatever the time zone of the computer.
  const [fecha, setFecha] = useState(() => bogotaToday(new Date()));
  const [placa, setPlaca] = useState("");
  const [tipoVehiculo, setTipoVehiculo] = useState("");
  const [result, setResult] = useState<Result>({ status: "loading" });
  // The stay being voided (FR-15). The panel takes the place of the history,
  // which keeps its filters and its results for when the panel closes.
  const [voiding, setVoiding] = useState<HistoryStay | null>(null);
  // The last void that was made.
  const [voided, setVoided] = useState<string | null>(null);

  async function search(filters: Filters, signal?: AbortSignal) {
    const plate = normalizePlateSearch(filters.placa);
    // Without a day or a plate the API answers 400, so it is not asked.
    if (filters.fecha === "" && plate === "") {
      setResult({ status: "rejected", message: "Elige un día o escribe una placa." });
      return;
    }
    const query = new URLSearchParams();
    if (filters.fecha !== "") query.set("fecha", filters.fecha);
    if (plate !== "") query.set("placa", plate);
    if (filters.tipoVehiculo !== "") query.set("tipoVehiculo", filters.tipoVehiculo);
    setResult({ status: "loading" });
    // null when the server cannot be reached or the screen closed.
    const response = await fetch(`${STAYS_URL}?${query}`, { signal }).catch(() => null);
    if (signal?.aborted) return;
    if (response?.ok) {
      const body: { estadias: HistoryStay[]; hayMas: boolean } = await response.json();
      setResult({ status: "loaded", stays: body.estadias, hayMas: body.hayMas });
    } else if (response?.status === 401) {
      onSessionEnded();
    } else if (response?.status === 400) {
      setResult({
        status: "rejected",
        message: "Revisa la placa: escribe de 1 a 6 letras o números.",
      });
    } else {
      setResult({ status: "failed" });
    }
  }

  useEffect(() => {
    // The stays that entered today, when the screen appears.
    const controller = new AbortController();
    search({ fecha, placa: "", tipoVehiculo: "" }, controller.signal);
    return () => controller.abort();
    // Only once: later searches come from the form.
  }, []);

  // The voided stay takes its row, in the same place.
  function replaceStay(stay: HistoryStay) {
    setResult((current) =>
      current.status === "loaded"
        ? { ...current, stays: current.stays.map((row) => (row.id === stay.id ? stay : row)) }
        : current,
    );
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    search({ fecha, placa, tipoVehiculo });
  }

  if (voiding) {
    return (
      <VoidStay
        stay={voiding}
        onVoided={(stay) => {
          replaceStay(stay);
          const receipt =
            voiding.comprobante === null
              ? ""
              : ` Su comprobante N.º ${voiding.comprobante.consecutivo} también quedó anulado.`;
          setVoided(`Estadía anulada: ${stay.placa}.${receipt}`);
          setVoiding(null);
        }}
        onClose={() => setVoiding(null)}
      />
    );
  }

  return (
    <section className="card">
      <h2>Historial</h2>
      <form className="history-filters" onSubmit={handleSubmit}>
        <div className="history-day">
          <label>
            Día
            <input type="date" value={fecha} onChange={(event) => setFecha(event.target.value)} />
          </label>
          <button type="button" className="button-secondary" onClick={() => setFecha("")}>
            Todos los días
          </button>
        </div>
        <label>
          Tipo de vehículo
          <select value={tipoVehiculo} onChange={(event) => setTipoVehiculo(event.target.value)}>
            <option value="">Todos</option>
            {Object.entries(VEHICLE_TYPES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="plate-search">
          Placa
          <input
            type="search"
            value={placa}
            onChange={(event) => setPlaca(event.target.value)}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="characters"
          />
        </label>
        <button type="submit" className="button-primary" disabled={result.status === "loading"}>
          Buscar
        </button>
      </form>
      {voided && (
        <p role="status" className="saved">
          {voided}
        </p>
      )}
      {result.status === "loading" && <p className="muted">Cargando…</p>}
      {result.status === "failed" && (
        <p role="alert" className="alert">
          No se pudo cargar el historial.
        </p>
      )}
      {result.status === "rejected" && (
        <p role="alert" className="alert">
          {result.message}
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
                {canVoid && <th className="column-exit">Acciones</th>}
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
                  {canVoid && (
                    <td className="column-exit">
                      {/* RI-04: a voided stay does not change. */}
                      {stay.estado !== "ANULADA" && (
                        <button
                          type="button"
                          className="button-secondary"
                          aria-label={`Anular estadía de ${stay.placa}`}
                          onClick={() => {
                            setVoided(null);
                            setVoiding(stay);
                          }}
                        >
                          Anular
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

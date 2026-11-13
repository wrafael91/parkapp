import { useEffect, useState } from "react";
import { VEHICLE_TYPES } from "./stay.ts";

// GET and POST /api/tarifas and /api/periodo-gracia (ADR 0008), with a relative
// URL and the default fetch, as in App.tsx: the browser sends the session
// cookie by itself (docs/modelo-amenazas.md, 7.3).
const RATES_URL = "/api/tarifas";
const GRACE_PERIOD_URL = "/api/periodo-gracia";

// A rate as the API answers it (ADR 0008).
type Tarifa = {
  tipoVehiculo: "CARRO" | "MOTO";
  valorMinuto: number;
  topeLegal: number;
  vigenteDesde: string;
};

type Loaded = { tarifas: Tarifa[]; minutos: number | null };

type Settings = { status: "loading" } | { status: "failed" } | ({ status: "loaded" } & Loaded);

// A message under a card: an error in an alert, or what was saved.
type Note = { kind: "error" | "saved"; text: string } | null;

const SAVE_FAILED = "No se pudo guardar. Intenta de nuevo.";
const ONLY_ADMINISTRATOR = "Solo un administrador puede cambiar las tarifas.";

// The rate and the grace period (US-11, US-12; Image 4 of the article). The
// server checks the role and the legal cap (BR-10); the page only shows them.
// A 401 means the session ended, so the page goes back to sign in.
export default function Rates({ onSessionEnded }: { onSessionEnded: () => void }) {
  const [settings, setSettings] = useState<Settings>({ status: "loading" });
  // What is written in each field, as text, so an empty field stays empty.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [graceDraft, setGraceDraft] = useState("");
  const [rateNote, setRateNote] = useState<Note>(null);
  const [graceNote, setGraceNote] = useState<Note>(null);
  const [savingRate, setSavingRate] = useState(false);
  const [savingGrace, setSavingGrace] = useState(false);

  useEffect(() => {
    // Loads once, when the screen appears.
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([fetch(RATES_URL, { signal }), fetch(GRACE_PERIOD_URL, { signal })])
      .then(async ([rates, grace]) => {
        if (rates.status === 401 || grace.status === 401) {
          onSessionEnded();
          return;
        }
        if (!rates.ok || !grace.ok) {
          setSettings({ status: "failed" });
          return;
        }
        const { tarifas }: { tarifas: Tarifa[] } = await rates.json();
        const { minutos }: { minutos: number | null } = await grace.json();
        setSettings({ status: "loaded", tarifas, minutos });
        setDrafts(
          Object.fromEntries(tarifas.map((rate) => [rate.tipoVehiculo, String(rate.valorMinuto)])),
        );
        setGraceDraft(minutos === null ? "" : String(minutos));
      })
      .catch(() => {
        if (!signal.aborted) setSettings({ status: "failed" });
      });
    return () => controller.abort();
    // Not a dependency, as in Stays.tsx: the first onSessionEnded is enough.
  }, []);

  async function saveRate(rate: Tarifa) {
    const vehicle = VEHICLE_TYPES[rate.tipoVehiculo].toLowerCase();
    // The server validates the value (RI-09): an empty field goes as 0.
    setSavingRate(true);
    // null when the server cannot be reached.
    const response = await fetch(RATES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipoVehiculo: rate.tipoVehiculo,
        valorMinuto: Number(drafts[rate.tipoVehiculo] ?? ""),
      }),
    }).catch(() => null);
    setSavingRate(false);
    if (response?.ok) {
      const saved: Tarifa = await response.json();
      setSettings((current) =>
        current.status === "loaded"
          ? {
              ...current,
              tarifas: current.tarifas.map((each) =>
                each.tipoVehiculo === saved.tipoVehiculo ? saved : each,
              ),
            }
          : current,
      );
      setRateNote({
        kind: "saved",
        text: `Tarifa de ${vehicle} guardada: $${saved.valorMinuto} por minuto.`,
      });
      return;
    }
    if (response?.status === 401) {
      onSessionEnded();
      return;
    }
    const body = response === null ? null : await response.json().catch(() => null);
    setRateNote({ kind: "error", text: rateError(body?.error?.codigo, vehicle, rate.topeLegal) });
  }

  async function saveGracePeriod() {
    setSavingGrace(true);
    const response = await fetch(GRACE_PERIOD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutos: graceDraft.trim() === "" ? null : Number(graceDraft) }),
    }).catch(() => null);
    setSavingGrace(false);
    if (response?.ok) {
      const saved: { minutos: number } = await response.json();
      setSettings((current) =>
        current.status === "loaded" ? { ...current, minutos: saved.minutos } : current,
      );
      const unit = saved.minutos === 1 ? "minuto" : "minutos";
      setGraceNote({
        kind: "saved",
        text: `Periodo de gracia guardado: ${saved.minutos} ${unit}.`,
      });
      return;
    }
    if (response?.status === 401) {
      onSessionEnded();
      return;
    }
    const body = response === null ? null : await response.json().catch(() => null);
    setGraceNote({ kind: "error", text: graceError(body?.error?.codigo) });
  }

  if (settings.status === "loading") return <p className="muted">Cargando…</p>;
  if (settings.status === "failed") {
    return (
      <p role="alert" className="alert">
        No se pudieron cargar las tarifas.
      </p>
    );
  }

  return (
    <div className="rates">
      <section className="card">
        <h2>Tarifa por minuto</h2>
        <p className="muted">
          La tarifa no puede superar el tope legal que fija el Distrito para cada tipo de vehículo.
          Una tarifa nueva se aplica a los vehículos que ingresen desde ese momento: los que ya
          están dentro conservan la de su ingreso.
        </p>
        <div className="table-scroll">
          <table className="rates-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Tope legal</th>
                <th>Tarifa actual</th>
                <th>Nueva tarifa</th>
                <th>
                  <span className="visually-hidden">Guardar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {settings.tarifas.map((rate) => {
                const vehicle = VEHICLE_TYPES[rate.tipoVehiculo];
                return (
                  <tr key={rate.tipoVehiculo}>
                    <td>{vehicle}</td>
                    <td>${rate.topeLegal}</td>
                    <td>${rate.valorMinuto}</td>
                    <td>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        aria-label={`Nueva tarifa de ${vehicle.toLowerCase()}`}
                        value={drafts[rate.tipoVehiculo] ?? ""}
                        onChange={(event) =>
                          setDrafts({ ...drafts, [rate.tipoVehiculo]: event.target.value })
                        }
                      />
                    </td>
                    <td className="column-save">
                      <button
                        type="button"
                        className="button-primary"
                        aria-label={`Guardar tarifa de ${vehicle.toLowerCase()}`}
                        disabled={savingRate}
                        onClick={() => saveRate(rate)}
                      >
                        Guardar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <NoteLine note={rateNote} />
      </section>
      <section className="card">
        <h2>Periodo de gracia</h2>
        <p className="muted">
          Si el vehículo sale dentro de este tiempo, no se cobra. Si lo supera, se cobran todos los
          minutos.
        </p>
        <label>
          Minutos de gracia
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={graceDraft}
            onChange={(event) => setGraceDraft(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button-primary"
          disabled={savingGrace}
          onClick={saveGracePeriod}
        >
          Guardar
        </button>
        <NoteLine note={graceNote} />
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

// The page reads the API's error code (ADR 0008, decision 6) and writes its
// own message, with the cap it already shows (BR-10).
function rateError(codigo: string | undefined, vehicle: string, cap: number): string {
  switch (codigo) {
    case "TARIFA_SUPERA_TOPE":
      return `La tarifa de ${vehicle} no puede superar el tope legal de $${cap}.`;
    case "ENTRADA_INVALIDA":
      return "La tarifa debe ser un número entero de pesos mayor que cero.";
    case "ACCESO_DENEGADO":
      return ONLY_ADMINISTRATOR;
    default:
      return SAVE_FAILED;
  }
}

function graceError(codigo: string | undefined): string {
  switch (codigo) {
    case "ENTRADA_INVALIDA":
      return "Los minutos de gracia deben ser un número entero, desde 0.";
    case "ACCESO_DENEGADO":
      return ONLY_ADMINISTRATOR;
    default:
      return SAVE_FAILED;
  }
}

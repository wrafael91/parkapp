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

// The rate and the grace period (US-11, US-12; Image 4 of the article). The
// server checks the role and the legal cap (BR-10); the page only shows them.
// A 401 means the session ended, so the page goes back to sign in.
export default function Rates({ onSessionEnded }: { onSessionEnded: () => void }) {
  const [settings, setSettings] = useState<Settings>({ status: "loading" });
  // What is written in each field, as text, so an empty field stays empty.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [graceDraft, setGraceDraft] = useState("");

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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
      </section>
    </div>
  );
}

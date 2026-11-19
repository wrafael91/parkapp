import { useEffect, useState } from "react";
import { formatPesos, groupDigits, VEHICLE_TYPES } from "./stay.ts";

// GET and POST /api/tarifas, /api/periodo-gracia, /api/tope-periodo and
// /api/cupos (ADR 0008), with a relative URL and the default fetch, as in
// App.tsx: the browser sends the session cookie by itself
// (docs/modelo-amenazas.md, 7.3).
const RATES_URL = "/api/tarifas";
const GRACE_PERIOD_URL = "/api/periodo-gracia";
const PERIOD_CAP_URL = "/api/tope-periodo";
const CAPACITY_URL = "/api/cupos";

// A rate as the API answers it (ADR 0008).
type Tarifa = {
  tipoVehiculo: "CARRO" | "MOTO";
  valorMinuto: number;
  topeLegal: number;
  vigenteDesde: string;
};

// The cap per period as the API answers it, or null when it is off (BR-18).
type TopePeriodo = { horas: number; valor: number; vigenteDesde: string };

// The spaces of a vehicle type as the API answers them (FR-24): null when the
// type has no limit (BR-19).
type Cupo = {
  tipoVehiculo: "CARRO" | "MOTO";
  cupos: number | null;
  ocupados: number;
  libres: number | null;
};

type Loaded = {
  tarifas: Tarifa[];
  minutos: number | null;
  topePeriodo: TopePeriodo | null;
  cupos: Cupo[];
};

type Settings = { status: "loading" } | { status: "failed" } | ({ status: "loaded" } & Loaded);

// A message under a card: an error in an alert, or what was saved.
type Note = { kind: "error" | "saved"; text: string } | null;

const SAVE_FAILED = "No se pudo guardar. Intenta de nuevo.";
const ONLY_ADMINISTRATOR = "Solo un administrador puede cambiar las tarifas.";
const CAP_OFF = "Tope desactivado: los vehículos que ingresen desde ahora se cobran sin tope.";
const PLURAL_TYPES = { CARRO: "carros", MOTO: "motos" };
const WITH_ARTICLE = { CARRO: "los carros", MOTO: "las motos" };
const SPACES_NAMES = { CARRO: "Carros", MOTO: "Motos" };

// The rate, the grace period, the cap per period and the spaces (US-11, US-12,
// US-16, US-17; Image 4 of the article). The server checks the role, the legal
// cap (BR-10) and the limits of the cap and the spaces (RI-20, RI-21); the page
// only shows them.
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
  const [hoursDraft, setHoursDraft] = useState("");
  const [capValueDraft, setCapValueDraft] = useState("");
  const [capNote, setCapNote] = useState<Note>(null);
  const [savingCap, setSavingCap] = useState(false);
  const [spacesDrafts, setSpacesDrafts] = useState<Record<string, string>>({});
  const [spacesNote, setSpacesNote] = useState<Note>(null);
  const [savingSpaces, setSavingSpaces] = useState(false);

  useEffect(() => {
    // Loads once, when the screen appears.
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      fetch(RATES_URL, { signal }),
      fetch(GRACE_PERIOD_URL, { signal }),
      fetch(PERIOD_CAP_URL, { signal }),
      fetch(CAPACITY_URL, { signal }),
    ])
      .then(async (responses) => {
        if (responses.some((response) => response.status === 401)) {
          onSessionEnded();
          return;
        }
        if (responses.some((response) => !response.ok)) {
          setSettings({ status: "failed" });
          return;
        }
        const [rates, grace, cap, capacity] = responses;
        const { tarifas }: { tarifas: Tarifa[] } = await rates.json();
        const { minutos }: { minutos: number | null } = await grace.json();
        const { topePeriodo }: { topePeriodo: TopePeriodo | null } = await cap.json();
        const { cupos }: { cupos: Cupo[] } = await capacity.json();
        setSettings({ status: "loaded", tarifas, minutos, topePeriodo, cupos });
        setDrafts(
          Object.fromEntries(tarifas.map((rate) => [rate.tipoVehiculo, String(rate.valorMinuto)])),
        );
        setGraceDraft(minutos === null ? "" : String(minutos));
        setHoursDraft(topePeriodo === null ? "" : String(topePeriodo.horas));
        setCapValueDraft(topePeriodo === null ? "" : String(topePeriodo.valor));
        setSpacesDrafts(
          Object.fromEntries(
            cupos.map((cupo) => [cupo.tipoVehiculo, cupo.cupos === null ? "" : String(cupo.cupos)]),
          ),
        );
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
      body: JSON.stringify({ minutos: numberOrNull(graceDraft) }),
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

  // Turns the cap on or changes it with { horas, valor }, or turns it off with
  // { activo: false } (BR-18). The server validates the values (RI-20): an empty
  // field goes as null. The stays inside keep their cap (BR-11).
  async function sendCap(change: object) {
    setSavingCap(true);
    const response = await fetch(PERIOD_CAP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    }).catch(() => null);
    setSavingCap(false);
    if (response?.ok) {
      const { topePeriodo }: { topePeriodo: TopePeriodo | null } = await response.json();
      setSettings((current) =>
        current.status === "loaded" ? { ...current, topePeriodo } : current,
      );
      setCapNote({
        kind: "saved",
        text: topePeriodo === null ? CAP_OFF : `Tope guardado: ${describeCap(topePeriodo)}.`,
      });
      return;
    }
    if (response?.status === 401) {
      onSessionEnded();
      return;
    }
    const body = response === null ? null : await response.json().catch(() => null);
    const codigo: string | undefined = body?.error?.codigo;
    // Someone else turned it off first: the card shows it off.
    if (codigo === "SIN_TOPE_PERIODO") {
      setSettings((current) =>
        current.status === "loaded" ? { ...current, topePeriodo: null } : current,
      );
    }
    setCapNote({ kind: "error", text: capError(codigo) });
  }

  // Sets the spaces of a vehicle type, or removes its limit when the field is
  // empty (BR-19). The server validates the value (RI-21).
  async function saveSpaces(tipoVehiculo: Cupo["tipoVehiculo"]) {
    const vehicles = PLURAL_TYPES[tipoVehiculo];
    setSavingSpaces(true);
    const response = await fetch(CAPACITY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipoVehiculo,
        cupos: numberOrNull(spacesDrafts[tipoVehiculo] ?? ""),
      }),
    }).catch(() => null);
    setSavingSpaces(false);
    if (response?.ok) {
      const saved: Cupo = await response.json();
      replaceSpaces(saved);
      setSpacesNote({
        kind: "saved",
        text:
          saved.cupos === null
            ? `Límite de ${vehicles} quitado: ${WITH_ARTICLE[tipoVehiculo]} entran sin límite de cupos.`
            : `Cupos de ${vehicles} guardados: ${groupDigits(saved.cupos)}.`,
      });
      return;
    }
    if (response?.status === 401) {
      onSessionEnded();
      return;
    }
    const body = response === null ? null : await response.json().catch(() => null);
    const codigo: string | undefined = body?.error?.codigo;
    // Someone else removed the limit first: the card shows it without a limit.
    if (codigo === "SIN_CUPOS_CONFIGURADOS") {
      const current = settings.status === "loaded" ? settings.cupos : [];
      const shown = current.find((cupo) => cupo.tipoVehiculo === tipoVehiculo);
      if (shown) replaceSpaces({ ...shown, cupos: null, libres: null });
    }
    setSpacesNote({ kind: "error", text: spacesError(codigo, WITH_ARTICLE[tipoVehiculo]) });
  }

  function replaceSpaces(saved: Cupo) {
    setSettings((current) =>
      current.status === "loaded"
        ? {
            ...current,
            cupos: current.cupos.map((each) =>
              each.tipoVehiculo === saved.tipoVehiculo ? saved : each,
            ),
          }
        : current,
    );
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
      <section className="card">
        <h2>Tope por periodo</h2>
        <p className="muted">
          Lo máximo que se cobra por cada periodo de horas, contado desde el ingreso del vehículo.
          Aplica a carros y motos. Los vehículos que ya están dentro conservan el tope con el que
          ingresaron.
        </p>
        <p className="cap-status">
          Tope actual:{" "}
          <strong>
            {settings.topePeriodo === null ? "desactivado" : describeCap(settings.topePeriodo)}
          </strong>
        </p>
        <label>
          Periodo (horas)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={24}
            step={1}
            value={hoursDraft}
            onChange={(event) => setHoursDraft(event.target.value)}
          />
        </label>
        <label>
          Valor máximo por periodo
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={1000000}
            step={1}
            value={capValueDraft}
            onChange={(event) => setCapValueDraft(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button-primary"
          disabled={savingCap}
          onClick={() =>
            sendCap({ horas: numberOrNull(hoursDraft), valor: numberOrNull(capValueDraft) })
          }
        >
          Guardar tope
        </button>
        {settings.topePeriodo !== null && (
          <button
            type="button"
            className="button-secondary"
            disabled={savingCap}
            onClick={() => sendCap({ activo: false })}
          >
            Desactivar tope
          </button>
        )}
        <NoteLine note={capNote} />
      </section>
      <section className="card">
        <h2>Cupos del parqueadero</h2>
        <p className="muted">
          Cuántos vehículos de cada tipo caben. Cuando no quedan cupos de un tipo, no se pueden
          registrar más ingresos de ese tipo, y el otro sigue entrando. Deja el campo vacío para
          quitar el límite; con 0, ese tipo de vehículo no puede entrar.
        </p>
        <div className="table-scroll">
          <table className="rates-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Dentro</th>
                <th>Cupos actuales</th>
                <th>Nuevos cupos</th>
                <th>
                  <span className="visually-hidden">Guardar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {settings.cupos.map((cupo) => {
                const vehicles = PLURAL_TYPES[cupo.tipoVehiculo];
                return (
                  <tr key={cupo.tipoVehiculo}>
                    <td>{SPACES_NAMES[cupo.tipoVehiculo]}</td>
                    <td>{groupDigits(cupo.ocupados)}</td>
                    <td>{cupo.cupos === null ? "Sin límite" : groupDigits(cupo.cupos)}</td>
                    <td>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={10000}
                        step={1}
                        aria-label={`Nuevos cupos de ${vehicles}`}
                        value={spacesDrafts[cupo.tipoVehiculo] ?? ""}
                        onChange={(event) =>
                          setSpacesDrafts({
                            ...spacesDrafts,
                            [cupo.tipoVehiculo]: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td className="column-save">
                      <button
                        type="button"
                        className="button-primary"
                        aria-label={`Guardar cupos de ${vehicles}`}
                        disabled={savingSpaces}
                        onClick={() => saveSpaces(cupo.tipoVehiculo)}
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
        <NoteLine note={spacesNote} />
      </section>
    </div>
  );
}

// What is written in a number field, or null if it is empty.
function numberOrNull(draft: string): number | null {
  return draft.trim() === "" ? null : Number(draft);
}

// $11.000 cada 12 horas (BR-18).
function describeCap(cap: TopePeriodo): string {
  return `${formatPesos(cap.valor)} cada ${cap.horas} ${cap.horas === 1 ? "hora" : "horas"}`;
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

function capError(codigo: string | undefined): string {
  switch (codigo) {
    case "ENTRADA_INVALIDA":
      return "El periodo debe ser de 1 a 24 horas, y el valor, un número entero de pesos entre $1 y $1.000.000.";
    case "SIN_TOPE_PERIODO":
      return "El tope ya estaba desactivado.";
    case "ACCESO_DENEGADO":
      return ONLY_ADMINISTRATOR;
    default:
      return SAVE_FAILED;
  }
}

function spacesError(codigo: string | undefined, theVehicles: string): string {
  switch (codigo) {
    case "ENTRADA_INVALIDA":
      return "Los cupos deben ser un número entero de 0 a 10.000. Deja el campo vacío para quitar el límite.";
    case "SIN_CUPOS_CONFIGURADOS":
      return `${theVehicles[0]!.toUpperCase()}${theVehicles.slice(1)} ya no tenían límite de cupos.`;
    case "CUPOS_CAMBIARON":
      return "Otro administrador cambió los cupos al mismo tiempo. Recarga la página, revisa los valores y vuelve a guardar.";
    case "ACCESO_DENEGADO":
      return "Solo un administrador puede cambiar los cupos.";
    default:
      return SAVE_FAILED;
  }
}

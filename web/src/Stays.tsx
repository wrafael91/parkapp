import { useEffect, useState, type SubmitEvent } from "react";
import Exit from "./Exit.tsx";
import {
  formatEntryTime,
  groupDigits,
  normalizePlateSearch,
  VEHICLE_TYPES,
  type Estadia,
} from "./stay.ts";

// GET and POST /api/estadias and GET /api/cupos (ADR 0008), with a relative URL
// and the default fetch, as in App.tsx: the browser sends the session cookie by
// itself, without credentials: "include" (docs/modelo-amenazas.md, 7.3).
const STAYS_URL = "/api/estadias";
const CAPACITY_URL = "/api/cupos";

type List = { status: "loading" } | { status: "failed" } | { status: "loaded"; stays: Estadia[] };

// The spaces of each vehicle type as the API answers them (FR-24); null when the
// type has no limit (BR-19).
type Cupo = { tipoVehiculo: "CARRO" | "MOTO"; cupos: number | null };

type Board = { status: "loading" } | { status: "failed" } | { status: "loaded"; cupos: Cupo[] };

// The screen after signing in: the entry form and the vehicles inside (US-06,
// US-07), and the exit of each one (US-08, US-09). A 401 means the session
// ended, so the page goes back to sign in. canCorrect is true for an
// administrator, who can also correct each entry (US-10).
export default function Stays({
  onSessionEnded,
}: {
  onSessionEnded: () => void;
  canCorrect?: boolean;
}) {
  const [list, setList] = useState<List>({ status: "loading" });
  // The stay whose exit is being registered. While there is one, the exit takes
  // the place of the form and the list.
  const [leaving, setLeaving] = useState<Estadia | null>(null);
  // Why the last exit could not be registered, when the stay was gone.
  const [exitError, setExitError] = useState<string | null>(null);
  // The plate search, as typed (FR-11). It stays while an exit is registered.
  const [search, setSearch] = useState("");
  const [board, setBoard] = useState<Board>({ status: "loading" });
  // Changes when the list and the board must be asked for again: after an entry
  // was rejected because no spaces were left, another operator may have
  // registered vehicles this screen does not show yet.
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    // Loads when the screen appears. The API sends the newest first. The board
    // is asked for after the list, so it counts the same vehicles.
    const controller = new AbortController();
    const { signal } = controller;
    fetch(`${STAYS_URL}?estado=ACTIVA`, { signal })
      .then(async (response) => {
        if (response.ok) {
          const body: { estadias: Estadia[] } = await response.json();
          setList({ status: "loaded", stays: body.estadias });
          await loadBoard(signal);
        } else if (response.status === 401) {
          onSessionEnded();
        } else {
          setList({ status: "failed" });
        }
      })
      .catch(() => {
        if (!signal.aborted) setList({ status: "failed" });
      });
    return () => controller.abort();
    // Not a dependency: onSessionEnded only sets the session state in App.tsx,
    // so the first one is enough.
  }, [loads]);

  async function loadBoard(signal: AbortSignal) {
    const response = await fetch(CAPACITY_URL, { signal }).catch(() => null);
    if (response?.ok) {
      const body: { cupos: Cupo[] } = await response.json();
      setBoard({ status: "loaded", cupos: body.cupos });
    } else if (response?.status === 401) {
      onSessionEnded();
    } else if (!signal.aborted) {
      setBoard({ status: "failed" });
    }
  }

  // The new stay is the newest, so it goes first, as the API would list it.
  function addStay(stay: Estadia) {
    setList((current) =>
      current.status === "loaded" ? { status: "loaded", stays: [stay, ...current.stays] } : current,
    );
  }

  // The stay left, or it was no longer active, so it leaves the list.
  function removeStay(id: number) {
    setList((current) =>
      current.status === "loaded"
        ? { status: "loaded", stays: current.stays.filter((stay) => stay.id !== id) }
        : current,
    );
  }

  // The list on screen is filtered, without asking the API again: the vehicles
  // inside are already loaded, and new entries and exits keep it up to date.
  const searched = normalizePlateSearch(search);
  const shown =
    list.status === "loaded" ? list.stays.filter((stay) => stay.placa.includes(searched)) : [];

  if (leaving) {
    return (
      <Exit
        stay={leaving}
        onExited={() => removeStay(leaving.id)}
        onGone={(message) => {
          removeStay(leaving.id);
          setExitError(message);
          setLeaving(null);
        }}
        onClose={() => setLeaving(null)}
        onSessionEnded={onSessionEnded}
      />
    );
  }

  return (
    <div className="operation">
      <section className="card">
        <h2>Registrar ingreso</h2>
        <EntryForm
          onRegistered={addStay}
          onNoSpaces={() => setLoads((count) => count + 1)}
          onSessionEnded={onSessionEnded}
        />
      </section>
      <section className="card">
        <h2>Vehículos dentro</h2>
        {list.status === "loaded" && <CapacityBoard board={board} stays={list.stays} />}
        {exitError && (
          <p role="alert" className="alert">
            {exitError}
          </p>
        )}
        {list.status === "loading" && <p className="muted">Cargando…</p>}
        {list.status === "failed" && (
          <p role="alert" className="alert">
            No se pudo cargar la lista de vehículos.
          </p>
        )}
        {list.status === "loaded" && list.stays.length === 0 && (
          <p className="muted">No hay vehículos dentro.</p>
        )}
        {list.status === "loaded" && list.stays.length > 0 && (
          <label className="plate-search">
            Buscar por placa
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={20}
              autoComplete="off"
              autoCapitalize="characters"
            />
          </label>
        )}
        {list.status === "loaded" && list.stays.length > 0 && shown.length === 0 && (
          <p className="muted">
            Ningún vehículo dentro coincide con {searched}. Si ya salió, búscalo en Historial.
          </p>
        )}
        {shown.length > 0 && (
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
                  <th className="column-exit">Salida</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((stay) => (
                  <tr key={stay.id}>
                    <td>
                      <span className="plate">{stay.placa}</span>
                    </td>
                    <td>{VEHICLE_TYPES[stay.tipoVehiculo]}</td>
                    <td>{stay.color}</td>
                    <td>{stay.marca ?? "—"}</td>
                    <td>
                      <time dateTime={stay.horaIngreso}>{formatEntryTime(stay.horaIngreso)}</time>
                    </td>
                    <td className="column-exit">
                      <button
                        type="button"
                        className="button-secondary"
                        aria-label={`Registrar salida de ${stay.placa}`}
                        onClick={() => {
                          setExitError(null);
                          setLeaving(stay);
                        }}
                      >
                        Registrar salida
                      </button>
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

// "1 libre", "4 libres".
function count(value: number, one: string, many: string): string {
  return `${groupDigits(value)} ${value === 1 ? one : many}`;
}

const BOARD_NAMES = { CARRO: "Carros", MOTO: "Motos" };

// BR-19 and FR-24: for each vehicle type, the free spaces, the vehicles inside
// and the spaces, or only the vehicles inside when the type has no limit. The
// vehicles inside are counted in the list on screen, which every entry and exit
// keeps up to date, so the board and the list always agree.
function CapacityBoard({ board, stays }: { board: Board; stays: Estadia[] }) {
  if (board.status === "loading") return null;
  if (board.status === "failed") {
    return <p className="muted">No se pudo cargar el marcador de cupos.</p>;
  }
  return (
    <ul className="capacity-board" aria-label="Cupos">
      {board.cupos.map(({ tipoVehiculo, cupos }) => {
        const inside = stays.filter((stay) => stay.tipoVehiculo === tipoVehiculo).length;
        const occupied = count(inside, "ocupado", "ocupados");
        if (cupos === null) {
          return (
            <li key={tipoVehiculo}>
              {BOARD_NAMES[tipoVehiculo]}: {occupied}
            </li>
          );
        }
        const free = Math.max(0, cupos - inside);
        return (
          <li key={tipoVehiculo}>
            {BOARD_NAMES[tipoVehiculo]}: {count(free, "libre", "libres")} · {occupied} ·{" "}
            {count(cupos, "cupo", "cupos")}
            {free === 0 && (
              <>
                {" · "}
                <strong className="full">Lleno</strong>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const PLURAL_TYPES = { CARRO: "carros", MOTO: "motos" };

// The page reads the API's error code (ADR 0008, decision 6).
function entryError(codigo: string | undefined, tipoVehiculo: string): string {
  switch (codigo) {
    // BR-03 and FR-09: the alert of a possible cloned plate.
    case "PLACA_ACTIVA":
      return "La placa ya tiene una estadía activa: posible placa clonada.";
    // BR-19: the other vehicle type keeps entering.
    case "SIN_CUPO": {
      const vehicles = PLURAL_TYPES[tipoVehiculo as keyof typeof PLURAL_TYPES] ?? "vehículos";
      return `No se pueden registrar más ingresos de ${vehicles}: no quedan cupos. Contacta al administrador.`;
    }
    case "ENTRADA_INVALIDA":
      return "Revisa los datos: la placa de carro es como ABC123 y la de moto como ABC12D.";
    default:
      return "No se pudo registrar el ingreso. Intenta de nuevo.";
  }
}

function EntryForm({
  onRegistered,
  onNoSpaces,
  onSessionEnded,
}: {
  onRegistered: (stay: Estadia) => void;
  onNoSpaces: () => void;
  onSessionEnded: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const marca = String(form.get("marca") ?? "");
    // The server normalizes the plate and sets the entry time (FR-08, BR-16).
    // The button stays disabled until the answer arrives, so a double click
    // does not send two entries (R3 in docs/modelo-amenazas.md).
    setSending(true);
    // null when the server cannot be reached.
    const response = await fetch(STAYS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placa: form.get("placa"),
        tipoVehiculo: form.get("tipoVehiculo"),
        color: form.get("color"),
        marca: marca.trim() === "" ? null : marca,
      }),
    }).catch(() => null);
    setSending(false);
    if (response?.ok) {
      const stay: Estadia = await response.json();
      formElement.reset();
      setError(null);
      onRegistered(stay);
      return;
    }
    if (response?.status === 401) {
      onSessionEnded();
      return;
    }
    // What was typed stays in the form, so it can be fixed and sent again.
    const body: { error?: { codigo?: string } } | null = response
      ? await response.json().catch(() => null)
      : null;
    const codigo = body?.error?.codigo;
    setError(entryError(codigo, String(form.get("tipoVehiculo"))));
    // The board and the list may be behind: ask for them again.
    if (codigo === "SIN_CUPO") onNoSpaces();
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Placa
        <input
          name="placa"
          className="plate-input"
          required
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
        />
      </label>
      <label>
        Tipo de vehículo
        <select name="tipoVehiculo">
          <option value="CARRO">Carro</option>
          <option value="MOTO">Moto</option>
        </select>
      </label>
      <label>
        Color
        <input name="color" required maxLength={30} autoComplete="off" />
      </label>
      <label>
        Marca (opcional)
        <input name="marca" maxLength={40} autoComplete="off" />
      </label>
      <button type="submit" className="button-primary" disabled={sending}>
        Registrar ingreso
      </button>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </form>
  );
}

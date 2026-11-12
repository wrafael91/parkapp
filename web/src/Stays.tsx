import { useEffect, useState, type SubmitEvent } from "react";
import Exit from "./Exit.tsx";
import { formatEntryTime, VEHICLE_TYPES, type Estadia } from "./stay.ts";

// GET and POST /api/estadias (ADR 0008), with a relative URL and the default
// fetch, as in App.tsx: the browser sends the session cookie by itself, without
// credentials: "include" (docs/modelo-amenazas.md, 7.3).
const STAYS_URL = "/api/estadias";

type List = { status: "loading" } | { status: "failed" } | { status: "loaded"; stays: Estadia[] };

// The screen after signing in: the entry form and the vehicles inside (US-06,
// US-07), and the exit of each one (US-08, US-09). A 401 means the session
// ended, so the page goes back to sign in.
export default function Stays({ onSessionEnded }: { onSessionEnded: () => void }) {
  const [list, setList] = useState<List>({ status: "loading" });
  // The stay whose exit is being registered. While there is one, the exit takes
  // the place of the form and the list.
  const [leaving, setLeaving] = useState<Estadia | null>(null);
  // Why the last exit could not be registered, when the stay was gone.
  const [exitError, setExitError] = useState<string | null>(null);

  useEffect(() => {
    // Loads once, when the screen appears. The API sends the newest first.
    const controller = new AbortController();
    fetch(`${STAYS_URL}?estado=ACTIVA`, { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) {
          const body: { estadias: Estadia[] } = await response.json();
          setList({ status: "loaded", stays: body.estadias });
        } else if (response.status === 401) {
          onSessionEnded();
        } else {
          setList({ status: "failed" });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setList({ status: "failed" });
      });
    return () => controller.abort();
    // Not a dependency: onSessionEnded only sets the session state in App.tsx,
    // so the first one is enough, and the list is not asked for again.
  }, []);

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
    <>
      <h2>Registrar ingreso</h2>
      <EntryForm onRegistered={addStay} onSessionEnded={onSessionEnded} />
      <h2>Vehículos dentro</h2>
      {exitError && <p role="alert">{exitError}</p>}
      {list.status === "loading" && <p>Cargando…</p>}
      {list.status === "failed" && <p role="alert">No se pudo cargar la lista de vehículos.</p>}
      {list.status === "loaded" && list.stays.length === 0 && <p>No hay vehículos dentro.</p>}
      {list.status === "loaded" && list.stays.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Placa</th>
              <th>Tipo</th>
              <th>Color</th>
              <th>Marca</th>
              <th>Ingreso</th>
              <th>Salida</th>
            </tr>
          </thead>
          <tbody>
            {list.stays.map((stay) => (
              <tr key={stay.id}>
                <td>{stay.placa}</td>
                <td>{VEHICLE_TYPES[stay.tipoVehiculo]}</td>
                <td>{stay.color}</td>
                <td>{stay.marca ?? "—"}</td>
                <td>
                  <time dateTime={stay.horaIngreso}>{formatEntryTime(stay.horaIngreso)}</time>
                </td>
                <td>
                  <button
                    type="button"
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
      )}
    </>
  );
}

// The page reads the API's error code (ADR 0008, decision 6).
function entryError(codigo: string | undefined): string {
  switch (codigo) {
    // BR-03 and FR-09: the alert of a possible cloned plate.
    case "PLACA_ACTIVA":
      return "La placa ya tiene una estadía activa: posible placa clonada.";
    case "ENTRADA_INVALIDA":
      return "Revisa los datos: la placa de carro es como ABC123 y la de moto como ABC12D.";
    default:
      return "No se pudo registrar el ingreso. Intenta de nuevo.";
  }
}

function EntryForm({
  onRegistered,
  onSessionEnded,
}: {
  onRegistered: (stay: Estadia) => void;
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
    setError(entryError(body?.error?.codigo));
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Placa
        <input
          name="placa"
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
      <button type="submit" disabled={sending}>
        Registrar ingreso
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

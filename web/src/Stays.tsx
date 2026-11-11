import { useEffect, useState } from "react";

// GET /api/estadias (ADR 0008), with a relative URL and the default
// fetch, as in App.tsx: the browser sends the session cookie by itself, without
// credentials: "include" (docs/modelo-amenazas.md, 7.3).
const STAYS_URL = "/api/estadias";

// A stay as the API answers it (ADR 0008).
type Estadia = {
  id: number;
  placa: string;
  tipoVehiculo: "CARRO" | "MOTO";
  color: string;
  marca: string | null;
  horaIngreso: string;
};

const VEHICLE_TYPES = { CARRO: "Carro", MOTO: "Moto" };

// ADR 0008, decision 5: the API sends UTC and the page shows Bogotá time, as
// dd/mm HH:mm. It is put together from the parts, so the separators do not
// depend on the ICU version of each browser or Node.
const BOGOTA_TIME = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatEntryTime(iso: string): string {
  const parts = Object.fromEntries(
    BOGOTA_TIME.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`;
}

type List = { status: "loading" } | { status: "failed" } | { status: "loaded"; stays: Estadia[] };

// The screen after signing in: the vehicles inside (US-07). A 401 means the
// session ended, so the page goes back to sign in.
export default function Stays({ onSessionEnded }: { onSessionEnded: () => void }) {
  const [list, setList] = useState<List>({ status: "loading" });

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

  return (
    <>
      <h2>Vehículos dentro</h2>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

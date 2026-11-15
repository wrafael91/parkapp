// Shared by the list (Stays.tsx), the exit (Exit.tsx) and the rates (Rates.tsx).

// A stay as the API answers it (ADR 0008).
export type Estadia = {
  id: number;
  placa: string;
  tipoVehiculo: "CARRO" | "MOTO";
  color: string;
  marca: string | null;
  horaIngreso: string;
};

export const VEHICLE_TYPES = { CARRO: "Carro", MOTO: "Moto" };

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

export function formatEntryTime(iso: string): string {
  const parts = Object.fromEntries(
    BOGOTA_TIME.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`;
}

// A dot every three digits (1.380), put together by hand for the same reason.
export function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// The API sends whole pesos (ADR 0008).
export function formatPesos(value: number): string {
  return `$${groupDigits(value)}`;
}

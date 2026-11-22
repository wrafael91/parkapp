// Shared by the list (Stays.tsx), the exit (Exit.tsx), the correction
// (Correction.tsx) and the rates (Rates.tsx).

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

// FR-08 without the format check: what was typed, in uppercase and without
// spaces or hyphens, to find the plates that contain it (FR-11).
export function normalizePlateSearch(text: string): string {
  return text.toUpperCase().replace(/[\s-]/g, "");
}

// The API's error codes for a stay that is not inside anymore (ADR 0008,
// decision 6), with the page's message, or null for any other code. An
// administrator may have corrected it, so the exit and the correction ask for
// the list again and the replacement shows (FR-21).
export function goneMessage(codigo: string | undefined): string | null {
  switch (codigo) {
    case "ESTADIA_NO_ACTIVA":
      return "La estadía ya no está activa: puede que ya se haya registrado su salida o que ya se haya corregido.";
    case "NO_ENCONTRADO":
      return "La estadía no existe.";
    default:
      return null;
  }
}

// A stay of the history, as GET /api/estadias?fecha= answers it (ADR 0008).
export type HistoryStay = Estadia & {
  horaSalida: string | null;
  estado: "ACTIVA" | "CERRADA" | "ANULADA";
  comprobante: { consecutivo: number; total: number } | null;
};

export const STAY_STATES = { ACTIVA: "Dentro", CERRADA: "Cerrada", ANULADA: "Anulada" };

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

// The history spans years, so its times carry the year: dd/mm/aaaa HH:mm.
const BOGOTA_DATE_TIME = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDateTime(iso: string): string {
  const parts = Object.fromEntries(
    BOGOTA_DATE_TIME.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

// The day in Bogotá as AAAA-MM-DD, the value of a date field and of the API's
// fecha. Neither UTC nor the time zone of the computer, which may be another.
export function bogotaToday(now: Date): string {
  const parts = Object.fromEntries(
    BOGOTA_DATE_TIME.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// A dot every three digits (1.380), put together by hand for the same reason.
export function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// The API sends whole pesos (ADR 0008).
export function formatPesos(value: number): string {
  return `$${groupDigits(value)}`;
}

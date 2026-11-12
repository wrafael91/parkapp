import { useState } from "react";
import { formatEntryTime, VEHICLE_TYPES, type Estadia } from "./stay.ts";

// The receipt as POST /api/estadias/{id}/salida answers it, with the BR-14
// fields (ADR 0008).
type Comprobante = {
  consecutivo: number;
  estadiaId: number;
  placa: string;
  tipoVehiculo: "CARRO" | "MOTO";
  horaIngreso: string;
  horaSalida: string;
  minutosCompletos: number;
  valorMinuto: number;
  subtotal: number;
  ajusteRedondeo: number;
  total: number;
};

// The receipt shows the date and the seconds, in Bogotá: minutes are charged
// complete, so from 21:22:50 to 21:28:10 is 5 minutes, and without the seconds
// it would look like 6. Put together from the parts, as in stay.ts.
const RECEIPT_TIME = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function formatReceiptTime(iso: string): string {
  const parts = Object.fromEntries(
    RECEIPT_TIME.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// A dot every three digits (1.380), put together by hand for the same reason.
function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// The API sends whole pesos (ADR 0008).
function formatPesos(value: number): string {
  return `$${groupDigits(value)}`;
}

// The exit of one stay (US-08, US-09): first the entry data, to check that it
// matches the vehicle that leaves (BR-04), and then the receipt (BR-14).
export default function Exit({
  stay,
  onExited,
  onClose,
}: {
  stay: Estadia;
  onExited: () => void;
  onClose: () => void;
}) {
  const [receipt, setReceipt] = useState<Comprobante | null>(null);
  const [sending, setSending] = useState(false);

  async function confirmExit() {
    // No body: the server sets the exit time and the user, and calculates the
    // fee (BR-16, BR-11). The default fetch, without credentials (7.3). The
    // buttons stay disabled until the answer arrives.
    setSending(true);
    // null when the server cannot be reached.
    const response = await fetch(`/api/estadias/${stay.id}/salida`, { method: "POST" }).catch(
      () => null,
    );
    setSending(false);
    if (response?.ok) {
      setReceipt(await response.json());
      onExited();
    }
  }

  if (receipt) return <Receipt receipt={receipt} onClose={onClose} />;

  return (
    <section>
      <h2>Verificar salida</h2>
      <p>Revisa que los datos del ingreso coincidan con el vehículo que sale.</p>
      <dl>
        <dt>Placa</dt>
        <dd>{stay.placa}</dd>
        <dt>Tipo</dt>
        <dd>{VEHICLE_TYPES[stay.tipoVehiculo]}</dd>
        <dt>Color</dt>
        <dd>{stay.color}</dd>
        <dt>Marca</dt>
        <dd>{stay.marca ?? "—"}</dd>
        <dt>Ingreso</dt>
        <dd>
          <time dateTime={stay.horaIngreso}>{formatEntryTime(stay.horaIngreso)}</time>
        </dd>
      </dl>
      <button type="button" disabled={sending} onClick={confirmExit}>
        Confirmar salida
      </button>
      <button type="button" disabled={sending} onClick={onClose}>
        Cancelar
      </button>
    </section>
  );
}

// The receipt (BR-14, FR-14). When printed, only this section goes on the page
// (index.css).
function Receipt({ receipt, onClose }: { receipt: Comprobante; onClose: () => void }) {
  return (
    <section className="receipt">
      <p>RoloPark</p>
      <h2>Comprobante N.º {receipt.consecutivo}</h2>
      <dl>
        <dt>Placa</dt>
        <dd>{receipt.placa}</dd>
        <dt>Tipo</dt>
        <dd>{VEHICLE_TYPES[receipt.tipoVehiculo]}</dd>
        <dt>Ingreso</dt>
        <dd>{formatReceiptTime(receipt.horaIngreso)}</dd>
        <dt>Salida</dt>
        <dd>{formatReceiptTime(receipt.horaSalida)}</dd>
        <dt>Minutos cobrados</dt>
        <dd>{groupDigits(receipt.minutosCompletos)}</dd>
        <dt>Tarifa por minuto</dt>
        <dd>{formatPesos(receipt.valorMinuto)}</dd>
        <dt>Subtotal</dt>
        <dd>{formatPesos(receipt.subtotal)}</dd>
        <dt>Ajuste por redondeo</dt>
        <dd>
          {receipt.ajusteRedondeo > 0
            ? `−${formatPesos(receipt.ajusteRedondeo)}`
            : formatPesos(receipt.ajusteRedondeo)}
        </dd>
        <dt>Total (IVA incluido)</dt>
        <dd>{formatPesos(receipt.total)}</dd>
      </dl>
      <button type="button" onClick={() => window.print()}>
        Imprimir
      </button>
      <button type="button" onClick={onClose}>
        Cerrar
      </button>
    </section>
  );
}

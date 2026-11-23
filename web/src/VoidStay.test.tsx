import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import History from "./History.tsx";
import { jsonResponse, stubFetch } from "./test-helpers.ts";

// The void of a stay as the administrator goes through it, from History (FR-15,
// US-10). Only Date is faked, so userEvent keeps its real timers: History opens
// with the 15th, today in Bogotá.
function setNow(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

// Stays as the API answers them (ADR 0008): one inside and one closed with its
// receipt. 00:42 UTC on November 16 is 19:42 on November 15 in Bogotá.
const INSIDE = {
  id: 6,
  placa: "TST12A",
  tipoVehiculo: "MOTO",
  color: "Negro",
  marca: null,
  horaIngreso: "2026-11-15T14:52:00.000Z",
  horaSalida: null,
  estado: "ACTIVA",
  comprobante: null,
};
const CLOSED = {
  id: 30,
  placa: "TST130",
  tipoVehiculo: "CARRO",
  color: "Azul",
  marca: "Kia",
  horaIngreso: "2026-11-16T00:42:22.000Z",
  horaSalida: "2026-11-16T00:47:26.000Z",
  estado: "CERRADA",
  comprobante: { consecutivo: 8, total: 1350 },
};
const BOTH = { estadias: [CLOSED, INSIDE], hayMas: false };

function renderHistory(onSessionEnded = vi.fn()) {
  setNow("2026-11-16T03:30:00.000Z");
  render(<History onSessionEnded={onSessionEnded} canVoid />);
}

// The cells of each row of the table, without the header.
function rows() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    );
}

// Each term of the panel with its value.
function fields() {
  const values = screen.getAllByRole("definition");
  return screen
    .getAllByRole("term")
    .map((term, index) => [term.textContent, values[index].textContent]);
}

async function startVoid(user: UserEvent, placa: string) {
  await user.click(await screen.findByRole("button", { name: `Anular estadía de ${placa}` }));
}

// Writes the reason and confirms, as a person would.
async function confirmVoid(user: UserEvent, motivo = "Se le cobró al vehículo equivocado") {
  await user.type(screen.getByLabelText("Motivo"), motivo);
  await user.click(screen.getByRole("button", { name: "Anular estadía" }));
}

// The panel goes away when the API answers.
async function panelClosed() {
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Anular estadía" })).toBeNull());
}

describe("void panel (FR-15)", () => {
  it("shows a closed stay and says its receipt is voided too", async () => {
    stubFetch(jsonResponse(200, BOTH));
    const user = userEvent.setup();
    renderHistory();
    await startVoid(user, "TST130");
    screen.getByRole("heading", { name: "Anular estadía" });
    expect(fields()).toEqual([
      ["Placa", "TST130"],
      ["Tipo", "Carro"],
      ["Ingreso", "15/11/2026 19:42"],
      ["Salida", "15/11/2026 19:47"],
      ["Comprobante", "N.º 8 · $1.350"],
    ]);
    screen.getByText("El comprobante N.º 8 por $1.350 también queda anulado.");
    expect((screen.getByLabelText("Motivo") as HTMLInputElement).value).toBe("");
  });

  it("shows an active stay without exit or receipt", async () => {
    stubFetch(jsonResponse(200, BOTH));
    const user = userEvent.setup();
    renderHistory();
    await startVoid(user, "TST12A");
    expect(fields()).toEqual([
      ["Placa", "TST12A"],
      ["Tipo", "Moto"],
      ["Ingreso", "15/11/2026 09:52"],
    ]);
    expect(screen.queryByText(/también queda anulado/)).toBeNull();
  });

  it("takes the place of the history, and goes back without asking when canceled", async () => {
    const fetchMock = stubFetch(jsonResponse(200, BOTH));
    const user = userEvent.setup();
    renderHistory();
    await startVoid(user, "TST130");
    expect(screen.queryByRole("heading", { name: "Historial" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(rows().map((cells) => cells[0])).toEqual(["TST130", "TST12A"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the reason and the state it showed, with the default fetch", async () => {
    const voided = { ...CLOSED, estado: "ANULADA" };
    const fetchMock = stubFetch(jsonResponse(200, BOTH), jsonResponse(200, voided));
    const user = userEvent.setup();
    renderHistory();
    await startVoid(user, "TST130");
    await confirmVoid(user);
    await panelClosed();
    // The state it showed stops the void if the stay changed since; the server
    // sets the new state, the time and the user (BR-16). No credentials
    // (docs/modelo-amenazas.md, 7.3).
    expect(fetchMock).toHaveBeenLastCalledWith("/api/estadias/30/anulacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: "Se le cobró al vehículo equivocado", estado: "CERRADA" }),
    });
  });

  it("shows the row as voided, without its receipt, and says so", async () => {
    const voided = { ...CLOSED, estado: "ANULADA" };
    const fetchMock = stubFetch(jsonResponse(200, BOTH), jsonResponse(200, voided));
    const user = userEvent.setup();
    renderHistory();
    await startVoid(user, "TST130");
    await confirmVoid(user);
    await panelClosed();
    expect(rows()[0]).toEqual([
      "TST130",
      "Carro",
      "Azul",
      "Kia",
      "15/11/2026 19:42",
      "15/11/2026 19:47",
      "Anulada",
      "—",
      "",
    ]);
    expect(screen.getByRole("status").textContent).toBe(
      "Estadía anulada: TST130. Su comprobante N.º 8 también quedó anulado.",
    );
    // The history is not asked for again.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says an active stay was voided, without a receipt", async () => {
    const voided = { ...INSIDE, estado: "ANULADA" };
    const fetchMock = stubFetch(jsonResponse(200, BOTH), jsonResponse(200, voided));
    const user = userEvent.setup();
    renderHistory();
    await startVoid(user, "TST12A");
    await confirmVoid(user, "El vehículo no entró");
    await panelClosed();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      motivo: "El vehículo no entró",
      estado: "ACTIVA",
    });
    expect(screen.getByRole("status").textContent).toBe("Estadía anulada: TST12A.");
    expect(rows()[1][6]).toBe("Anulada");
  });

  it("disables the buttons until the API answers", async () => {
    const fetchMock = stubFetch(jsonResponse(200, BOTH));
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderHistory();
    await startVoid(user, "TST130");
    await confirmVoid(user);
    const confirm = screen.getByRole("button", { name: "Anular estadía" }) as HTMLButtonElement;
    const cancel = screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    answer(jsonResponse(200, { ...CLOSED, estado: "ANULADA" }));
    await panelClosed();
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Stays from "./Stays.tsx";
import { jsonResponse, stubFetch } from "./test-helpers.ts";

// The exit as the operator goes through it, from the list of vehicles inside.
// 02:22 UTC on November 11 is 21:22 on November 10 in Bogotá.
const CAR = {
  id: 7,
  placa: "ABC123",
  tipoVehiculo: "CARRO",
  color: "Rojo",
  marca: null,
  horaIngreso: "2026-11-11T02:22:00.000Z",
};
const MOTORCYCLE = {
  id: 8,
  placa: "ABC12D",
  tipoVehiculo: "MOTO",
  color: "Negro",
  marca: "Yamaha",
  horaIngreso: "2026-11-11T02:24:00.000Z",
};
const BOTH = { estadias: [MOTORCYCLE, CAR] };

// The demo example: 6 min 10 s at $230 with 5 minutes of grace. The receipt
// number is not the stay's id, so a page that showed the id would fail.
const RECEIPT = {
  consecutivo: 15,
  estadiaId: 7,
  placa: "ABC123",
  tipoVehiculo: "CARRO",
  horaIngreso: "2026-11-11T02:22:00.000Z",
  horaSalida: "2026-11-11T02:28:10.000Z",
  minutosCompletos: 6,
  valorMinuto: 230,
  subtotal: 1380,
  ajusteRedondeo: 30,
  total: 1350,
};

function renderStays(onSessionEnded = vi.fn()) {
  render(<Stays onSessionEnded={onSessionEnded} />);
}

// The plate of each row of the list, without the header.
function plates() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);
}

// Each term of the panel or the receipt with its value.
function fields() {
  const values = screen.getAllByRole("definition");
  return screen
    .getAllByRole("term")
    .map((term, index) => [term.textContent, values[index].textContent]);
}

async function startExit(user: UserEvent, placa: string) {
  await user.click(await screen.findByRole("button", { name: `Registrar salida de ${placa}` }));
}

async function confirmExit(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "Confirmar salida" }));
}

// The panel goes away when the API answers, with the receipt or the list.
async function panelClosed() {
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Verificar salida" })).toBeNull(),
  );
}

describe("exit verification", () => {
  it("shows the entry data in place of the form and the list", async () => {
    stubFetch(jsonResponse(200, BOTH));
    const user = userEvent.setup();
    renderStays();
    await startExit(user, "ABC123");
    expect(screen.getByRole("heading", { name: "Verificar salida" })).toBeTruthy();
    // BR-04: the operator checks them against the vehicle that leaves.
    expect(fields()).toEqual([
      ["Placa", "ABC123"],
      ["Tipo", "Carro"],
      ["Color", "Rojo"],
      ["Marca", "—"],
      ["Ingreso", "10/11 21:22"],
    ]);
    expect(screen.queryByRole("heading", { name: "Registrar ingreso" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("goes back to the list without asking the server when canceled", async () => {
    const fetchMock = stubFetch(jsonResponse(200, BOTH));
    const user = userEvent.setup();
    renderStays();
    await startExit(user, "ABC12D");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(plates()).toEqual(["ABC12D", "ABC123"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for the exit of that stay with the default fetch and no body", async () => {
    const fetchMock = stubFetch(jsonResponse(200, BOTH), jsonResponse(201, RECEIPT));
    const user = userEvent.setup();
    renderStays();
    await startExit(user, "ABC123");
    await confirmExit(user);
    await panelClosed();
    // The server sets the exit time and calculates the fee (BR-16, BR-11).
    // No credentials (docs/modelo-amenazas.md, 7.3).
    expect(fetchMock).toHaveBeenLastCalledWith("/api/estadias/7/salida", { method: "POST" });
  });

  it("disables the buttons until the API answers", async () => {
    const fetchMock = stubFetch(jsonResponse(200, BOTH));
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderStays();
    await startExit(user, "ABC123");
    await confirmExit(user);
    const confirm = screen.getByRole("button", { name: "Confirmar salida" }) as HTMLButtonElement;
    const cancel = screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    answer(jsonResponse(201, RECEIPT));
    await panelClosed();
  });
});

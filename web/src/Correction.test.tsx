import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Stays from "./Stays.tsx";
import { jsonResponse, stubFetch } from "./test-helpers.ts";

// The correction of an entry as the administrator goes through it, from the
// list of vehicles inside (US-10, FR-21). 02:22 UTC on November 11 is 21:22 on
// November 10 in Bogotá.
const CAR = {
  id: 7,
  placa: "ABC128",
  tipoVehiculo: "CARRO",
  color: "Rojo",
  marca: "Mazda",
  horaIngreso: "2026-11-11T02:22:00.000Z",
};
const MOTORCYCLE = {
  id: 8,
  placa: "ABC12D",
  tipoVehiculo: "MOTO",
  color: "Negro",
  marca: null,
  horaIngreso: "2026-11-11T02:24:00.000Z",
};
const VAN = {
  id: 9,
  placa: "XYZ789",
  tipoVehiculo: "CARRO",
  color: "Blanco",
  marca: "Renault",
  horaIngreso: "2026-11-11T02:20:00.000Z",
};
const THREE = { estadias: [MOTORCYCLE, CAR, VAN] };

// The replacement as POST /api/estadias/{id}/correccion answers it: a new id,
// the corrected data and the same entry time.
const REPLACEMENT = {
  id: 12,
  placa: "ABC123",
  tipoVehiculo: "CARRO",
  color: "Rojo",
  marca: "Mazda",
  horaIngreso: CAR.horaIngreso,
  reemplazaA: 7,
};

// The board as the API answers it: spaces for each type, or null for no limit.
function spaces(cars: number | null, motorcycles: number | null) {
  return {
    cupos: [
      { tipoVehiculo: "CARRO", cupos: cars, ocupados: 0, libres: null },
      { tipoVehiculo: "MOTO", cupos: motorcycles, ocupados: 0, libres: null },
    ],
  };
}

// The list of vehicles inside and then the board, as the screen asks for them.
function loaded(stays: object, board: object = spaces(null, null)) {
  return [jsonResponse(200, stays), jsonResponse(200, board)];
}

function renderStays(onSessionEnded = vi.fn()) {
  render(<Stays onSessionEnded={onSessionEnded} canCorrect />);
}

// The plate of each row of the list, without the header.
function plates() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);
}

async function boardLines() {
  const board = await screen.findByRole("list", { name: "Cupos" });
  return within(board)
    .getAllByRole("listitem")
    .map((line) => line.textContent);
}

function valueOf(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement).value;
}

async function startCorrection(user: UserEvent, placa: string) {
  await user.click(await screen.findByRole("button", { name: `Corregir ingreso de ${placa}` }));
}

// Changes the plate, writes the reason and saves, as a person would.
async function correctPlate(user: UserEvent, placa: string, motivo = "Placa mal digitada") {
  await user.clear(screen.getByLabelText("Placa"));
  await user.type(screen.getByLabelText("Placa"), placa);
  await user.type(screen.getByLabelText("Motivo"), motivo);
  await user.click(screen.getByRole("button", { name: "Guardar corrección" }));
}

// The form goes away when the API answers.
async function formClosed() {
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Corregir ingreso" })).toBeNull(),
  );
}

describe("correction form (US-10)", () => {
  it("fills in the current data and shows the entry time without a field for it", async () => {
    stubFetch(...loaded(THREE));
    const user = userEvent.setup();
    renderStays();
    await startCorrection(user, "ABC128");
    screen.getByRole("heading", { name: "Corregir ingreso" });
    expect(valueOf("Placa")).toBe("ABC128");
    expect(valueOf("Tipo de vehículo")).toBe("CARRO");
    expect(valueOf("Color")).toBe("Rojo");
    expect(valueOf("Marca (opcional)")).toBe("Mazda");
    expect(valueOf("Motivo")).toBe("");
    // BR-16: the server copies the entry time; the page only shows it.
    const entry = screen.getByRole("definition");
    expect(entry.textContent).toBe("10/11 21:22");
    expect(screen.getAllByRole("textbox").map((field) => field.getAttribute("name"))).toEqual([
      "placa",
      "color",
      "marca",
      "motivo",
    ]);
  });

  it("takes the place of the form and the list, and goes back without asking when canceled", async () => {
    const fetchMock = stubFetch(...loaded(THREE));
    const user = userEvent.setup();
    renderStays();
    await startCorrection(user, "ABC128");
    expect(screen.queryByRole("heading", { name: "Registrar ingreso" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(plates()).toEqual(["ABC12D", "ABC128", "XYZ789"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends the corrected data and the reason with the default fetch, without the entry time", async () => {
    const fetchMock = stubFetch(...loaded(THREE), jsonResponse(201, REPLACEMENT));
    const user = userEvent.setup();
    renderStays();
    await startCorrection(user, "ABC128");
    await user.clear(screen.getByLabelText("Marca (opcional)"));
    await correctPlate(user, "abc-123");
    await formClosed();
    // The server normalizes the plate and copies the entry time (FR-08, BR-16).
    // No credentials (docs/modelo-amenazas.md, 7.3).
    expect(fetchMock).toHaveBeenLastCalledWith("/api/estadias/7/correccion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placa: "abc-123",
        tipoVehiculo: "CARRO",
        color: "Rojo",
        marca: null,
        motivo: "Placa mal digitada",
      }),
    });
  });

  it("puts the replacement in the place of the row and says the correction was saved", async () => {
    const fetchMock = stubFetch(...loaded(THREE), jsonResponse(201, REPLACEMENT));
    const user = userEvent.setup();
    renderStays();
    await startCorrection(user, "ABC128");
    await correctPlate(user, "ABC123");
    await formClosed();
    expect(plates()).toEqual(["ABC12D", "ABC123", "XYZ789"]);
    expect(screen.getByRole("status").textContent).toBe(
      "Ingreso corregido: ABC123. La estadía anterior quedó anulada.",
    );
    // The list is not asked for again.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The replacement can be corrected or leave like any other row.
    screen.getByRole("button", { name: "Corregir ingreso de ABC123" });
    screen.getByRole("button", { name: "Registrar salida de ABC123" });
  });

  it("updates the board when the vehicle type changes (BR-19)", async () => {
    const asMotorcycle = { ...REPLACEMENT, placa: "ABC12E", tipoVehiculo: "MOTO" };
    const fetchMock = stubFetch(...loaded(THREE, spaces(3, 5)), jsonResponse(201, asMotorcycle));
    const user = userEvent.setup();
    renderStays();
    expect(await boardLines()).toEqual([
      "Carros: 1 libre · 2 ocupados · 3 cupos",
      "Motos: 4 libres · 1 ocupado · 5 cupos",
    ]);
    await startCorrection(user, "ABC128");
    await user.selectOptions(screen.getByLabelText("Tipo de vehículo"), "Moto");
    await correctPlate(user, "ABC12E", "Era una moto");
    await formClosed();
    const sent = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(sent).toMatchObject({ placa: "ABC12E", tipoVehiculo: "MOTO", motivo: "Era una moto" });
    expect(await boardLines()).toEqual([
      "Carros: 2 libres · 1 ocupado · 3 cupos",
      "Motos: 3 libres · 2 ocupados · 5 cupos",
    ]);
  });

  it("disables the buttons until the API answers", async () => {
    const fetchMock = stubFetch(...loaded(THREE));
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderStays();
    await startCorrection(user, "ABC128");
    await correctPlate(user, "ABC123");
    const save = screen.getByRole("button", { name: "Guardar corrección" }) as HTMLButtonElement;
    const cancel = screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    answer(jsonResponse(201, REPLACEMENT));
    await formClosed();
  });
});

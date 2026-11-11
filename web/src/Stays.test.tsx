import { render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Stays from "./Stays.tsx";
import { jsonResponse, stubFetch } from "./test-helpers.ts";

// Stays as the API answers them (ADR 0008). 02:22 UTC on November 11 is 21:22
// on November 10 in Bogotá, so a page that showed UTC or the computer's time
// zone would show another day or another hour.
const CAR = {
  id: 7,
  placa: "ABC123",
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
const NO_STAYS = { estadias: [] };
const INTERNAL_ERROR = {
  error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado." },
};

function renderStays() {
  render(<Stays onSessionEnded={vi.fn()} />);
}

// The cells of each row of the list, without the header.
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

describe("vehicles inside", () => {
  it("asks for the active stays with the default fetch", async () => {
    const fetchMock = stubFetch(jsonResponse(200, NO_STAYS));
    renderStays();
    await screen.findByText("No hay vehículos dentro.");
    // A relative URL and no credentials (docs/modelo-amenazas.md, 7.3).
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/estadias?estado=ACTIVA");
    expect(init).not.toHaveProperty("credentials");
  });

  it("lists them in the API's order, with the entry time in Bogotá", async () => {
    stubFetch(jsonResponse(200, { estadias: [MOTORCYCLE, CAR] }));
    renderStays();
    await screen.findByText("ABC12D");
    expect(rows()).toEqual([
      ["ABC12D", "Moto", "Negro", "—", "10/11 21:24"],
      ["ABC123", "Carro", "Rojo", "Mazda", "10/11 21:22"],
    ]);
  });

  it.each([
    ["fails", jsonResponse(500, INTERNAL_ERROR)],
    ["cannot be reached", new TypeError("Failed to fetch")],
  ])("says so when the server %s", async (_case, answer) => {
    stubFetch(answer);
    renderStays();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se pudo cargar la lista de vehículos.");
  });
});

// Fills in the entry form and submits it, as a person would.
async function registerEntry(
  user: UserEvent,
  entry: { placa: string; tipo: string; color: string; marca: string },
) {
  await user.type(await screen.findByLabelText("Placa"), entry.placa);
  await user.selectOptions(screen.getByLabelText("Tipo de vehículo"), entry.tipo);
  await user.type(screen.getByLabelText("Color"), entry.color);
  if (entry.marca !== "") await user.type(screen.getByLabelText("Marca (opcional)"), entry.marca);
  await user.click(screen.getByRole("button", { name: "Registrar ingreso" }));
}

const MOTORCYCLE_ENTRY = { placa: "abc-12d", tipo: "Moto", color: "Negro", marca: "" };

function valueOf(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement).value;
}

describe("entry", () => {
  it.each([
    ["no brand as null", "", null],
    ["the brand", "Yamaha", "Yamaha"],
  ])("sends the plate as typed and %s", async (_case, marca, expected) => {
    const fetchMock = stubFetch(
      jsonResponse(200, NO_STAYS),
      jsonResponse(201, { ...MOTORCYCLE, marca: expected }),
    );
    const user = userEvent.setup();
    renderStays();
    await registerEntry(user, { ...MOTORCYCLE_ENTRY, marca });
    await screen.findByText("ABC12D");
    // The server normalizes the plate and sets the time (FR-08, BR-16).
    expect(fetchMock).toHaveBeenLastCalledWith("/api/estadias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placa: "abc-12d",
        tipoVehiculo: "MOTO",
        color: "Negro",
        marca: expected,
      }),
    });
  });

  it("shows the new vehicle first and clears the form", async () => {
    stubFetch(jsonResponse(200, { estadias: [CAR] }), jsonResponse(201, MOTORCYCLE));
    const user = userEvent.setup();
    renderStays();
    await screen.findByText("ABC123");
    await registerEntry(user, MOTORCYCLE_ENTRY);
    await screen.findByText("ABC12D");
    expect(rows().map((cells) => cells[0])).toEqual(["ABC12D", "ABC123"]);
    expect(valueOf("Placa")).toBe("");
    expect(valueOf("Tipo de vehículo")).toBe("CARRO");
    expect(valueOf("Color")).toBe("");
    expect(valueOf("Marca (opcional)")).toBe("");
  });

  // R3 in docs/modelo-amenazas.md: nothing stops two entries of the same plate
  // at the same time until the partial unique index of #6.
  it("disables the button until the API answers", async () => {
    const fetchMock = stubFetch(jsonResponse(200, NO_STAYS));
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderStays();
    await registerEntry(user, MOTORCYCLE_ENTRY);
    const button = screen.getByRole("button", { name: "Registrar ingreso" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    answer(jsonResponse(201, MOTORCYCLE));
    await screen.findByText("ABC12D");
    expect(button.disabled).toBe(false);
  });
});

describe("rejected entry", () => {
  it.each([
    [
      "the plate is already inside",
      409,
      "PLACA_ACTIVA",
      "La placa ya tiene una estadía activa: posible placa clonada.",
    ],
    [
      "the data is not valid",
      400,
      "ENTRADA_INVALIDA",
      "Revisa los datos: la placa de carro es como ABC123 y la de moto como ABC12D.",
    ],
  ])("shows an alert and keeps the form when %s", async (_case, status, codigo, message) => {
    const rejected = { error: { codigo, mensaje: "Mensaje de la API." } };
    stubFetch(jsonResponse(200, { estadias: [CAR] }), jsonResponse(status, rejected));
    const user = userEvent.setup();
    renderStays();
    await registerEntry(user, MOTORCYCLE_ENTRY);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(valueOf("Placa")).toBe("abc-12d");
    expect(valueOf("Tipo de vehículo")).toBe("MOTO");
    expect(valueOf("Color")).toBe("Negro");
    expect(rows().map((cells) => cells[0])).toEqual(["ABC123"]);
  });

  it.each([
    ["fails", jsonResponse(500, INTERNAL_ERROR)],
    ["cannot be reached", new TypeError("Failed to fetch")],
  ])("shows a general error when the server %s", async (_case, answer) => {
    stubFetch(jsonResponse(200, NO_STAYS), answer);
    const user = userEvent.setup();
    renderStays();
    await registerEntry(user, MOTORCYCLE_ENTRY);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se pudo registrar el ingreso. Intenta de nuevo.");
    expect(valueOf("Placa")).toBe("abc-12d");
  });
});

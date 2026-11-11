import { render, screen, within } from "@testing-library/react";
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

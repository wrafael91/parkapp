import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Rates from "./Rates.tsx";
import { jsonResponse, stubFetch } from "./test-helpers.ts";

// The API's answers (ADR 0008): the production values, and a motorcycle rate
// below its cap, as in Image 4 of the article.
const RATES = {
  tarifas: [
    {
      tipoVehiculo: "CARRO",
      valorMinuto: 230,
      topeLegal: 230,
      vigenteDesde: "2026-11-07T17:35:00.000Z",
    },
    {
      tipoVehiculo: "MOTO",
      valorMinuto: 150,
      topeLegal: 161,
      vigenteDesde: "2026-11-07T17:35:00.000Z",
    },
  ],
};
const GRACE_PERIOD = { minutos: 5, vigenteDesde: "2026-11-07T17:35:00.000Z" };
const NO_SESSION = { error: { codigo: "NO_AUTENTICADO", mensaje: "No hay una sesión activa." } };
const INTERNAL_ERROR = {
  error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado." },
};

function loaded() {
  return [jsonResponse(200, RATES), jsonResponse(200, GRACE_PERIOD)];
}

function renderRates() {
  const onSessionEnded = vi.fn();
  render(<Rates onSessionEnded={onSessionEnded} />);
  return onSessionEnded;
}

// The cells of the row of a vehicle type in the rates table.
function rowOf(vehicle: string) {
  const row = screen.getByRole("cell", { name: vehicle }).closest("tr");
  if (row === null) throw new Error(`no row for ${vehicle}`);
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

describe("loading the rates", () => {
  it("shows each current rate with its legal cap, and the grace period", async () => {
    const fetchMock = stubFetch(...loaded());
    renderRates();

    await screen.findByRole("heading", { name: "Tarifa por minuto" });
    expect(rowOf("Carro").slice(0, 3)).toEqual(["Carro", "$230", "$230"]);
    expect(rowOf("Moto").slice(0, 3)).toEqual(["Moto", "$161", "$150"]);
    expect(screen.getByLabelText("Nueva tarifa de carro")).toHaveProperty("value", "230");
    expect(screen.getByLabelText("Nueva tarifa de moto")).toHaveProperty("value", "150");
    screen.getByRole("heading", { name: "Periodo de gracia" });
    expect(screen.getByLabelText("Minutos de gracia")).toHaveProperty("value", "5");
    // Relative URLs and the default fetch (docs/modelo-amenazas.md, 7.3).
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/tarifas",
      "/api/periodo-gracia",
    ]);
    for (const [, init] of fetchMock.mock.calls) expect(init).not.toHaveProperty("credentials");
  });

  it.each([
    ["fails", [jsonResponse(500, INTERNAL_ERROR), jsonResponse(200, GRACE_PERIOD)]],
    ["cannot be reached", [new TypeError("Failed to fetch"), new TypeError("Failed to fetch")]],
  ])("says so in an alert when the server %s", async (_case, answers) => {
    stubFetch(...answers);
    renderRates();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No se pudieron cargar las tarifas.",
    );
  });

  it("goes back to sign in when the session ended (401)", async () => {
    stubFetch(jsonResponse(401, NO_SESSION), jsonResponse(401, NO_SESSION));
    const onSessionEnded = renderRates();

    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
  });
});

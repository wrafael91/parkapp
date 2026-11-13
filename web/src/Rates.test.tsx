import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function apiError(codigo: string) {
  return { error: { codigo, mensaje: "Un mensaje de la API que la página no muestra." } };
}

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

describe("saving a rate (US-11)", () => {
  it("sends the new value and shows it as the current rate", async () => {
    const fetchMock = stubFetch(
      ...loaded(),
      jsonResponse(201, {
        tipoVehiculo: "CARRO",
        valorMinuto: 200,
        topeLegal: 230,
        vigenteDesde: "2026-11-13T02:00:00.000Z",
      }),
    );
    const user = userEvent.setup();
    renderRates();
    const field = await screen.findByLabelText("Nueva tarifa de carro");

    await user.clear(field);
    await user.type(field, "200");
    await user.click(screen.getByRole("button", { name: "Guardar tarifa de carro" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Tarifa de carro guardada: $200 por minuto.",
    );
    expect(rowOf("Carro").slice(0, 3)).toEqual(["Carro", "$230", "$200"]);
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe("/api/tarifas");
    expect(init).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoVehiculo: "CARRO", valorMinuto: 200 }),
    });
  });

  it("disables the buttons while it waits for the answer", async () => {
    let answer: (response: Response) => void = () => {};
    const fetchMock = stubFetch(...loaded());
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderRates();
    const save = await screen.findByRole("button", { name: "Guardar tarifa de moto" });

    await user.click(save);

    expect(save).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Guardar tarifa de carro" })).toHaveProperty(
      "disabled",
      true,
    );
    answer(jsonResponse(500, INTERNAL_ERROR));
    await screen.findByRole("alert");
    expect(save).toHaveProperty("disabled", false);
  });

  it.each([
    [
      "above the legal cap (BR-10)",
      jsonResponse(400, apiError("TARIFA_SUPERA_TOPE")),
      "La tarifa de moto no puede superar el tope legal de $161.",
    ],
    [
      "invalid (RI-09)",
      jsonResponse(400, apiError("ENTRADA_INVALIDA")),
      "La tarifa debe ser un número entero de pesos mayor que cero.",
    ],
    [
      "denied (NFR-05)",
      jsonResponse(403, apiError("ACCESO_DENEGADO")),
      "Solo un administrador puede cambiar las tarifas.",
    ],
    ["failed", jsonResponse(500, INTERNAL_ERROR), "No se pudo guardar. Intenta de nuevo."],
    ["not sent", new TypeError("Failed to fetch"), "No se pudo guardar. Intenta de nuevo."],
  ])(
    "explains a rate %s in an alert and keeps the current rate",
    async (_case, answer, message) => {
      stubFetch(...loaded(), answer);
      const user = userEvent.setup();
      renderRates();
      const field = await screen.findByLabelText("Nueva tarifa de moto");

      await user.clear(field);
      await user.type(field, "170");
      await user.click(screen.getByRole("button", { name: "Guardar tarifa de moto" }));

      expect((await screen.findByRole("alert")).textContent).toBe(message);
      expect(rowOf("Moto").slice(0, 3)).toEqual(["Moto", "$161", "$150"]);
      expect(field).toHaveProperty("value", "170");
    },
  );

  it("goes back to sign in when the session ended while saving (401)", async () => {
    stubFetch(...loaded(), jsonResponse(401, NO_SESSION));
    const user = userEvent.setup();
    const onSessionEnded = renderRates();

    await user.click(await screen.findByRole("button", { name: "Guardar tarifa de carro" }));

    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
  });
});

describe("saving the grace period (US-12)", () => {
  it("sends the minutes and says it was saved", async () => {
    const fetchMock = stubFetch(
      ...loaded(),
      jsonResponse(201, { minutos: 10, vigenteDesde: "2026-11-13T02:00:00.000Z" }),
    );
    const user = userEvent.setup();
    renderRates();
    const field = await screen.findByLabelText("Minutos de gracia");

    await user.clear(field);
    await user.type(field, "10");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Periodo de gracia guardado: 10 minutos.",
    );
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe("/api/periodo-gracia");
    expect(init).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutos: 10 }),
    });
  });

  it("sends an empty field as null, so the server rejects it (RI-10)", async () => {
    const fetchMock = stubFetch(...loaded(), jsonResponse(400, apiError("ENTRADA_INVALIDA")));
    const user = userEvent.setup();
    renderRates();

    await user.clear(await screen.findByLabelText("Minutos de gracia"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Los minutos de gracia deben ser un número entero, desde 0.",
    );
    expect(fetchMock.mock.calls[2][1]?.body).toBe(JSON.stringify({ minutos: null }));
  });

  it("explains a failure in an alert", async () => {
    stubFetch(...loaded(), new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    renderRates();

    await user.click(await screen.findByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No se pudo guardar. Intenta de nuevo.",
    );
  });
});

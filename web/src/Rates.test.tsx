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
// Lot B's cap (BR-18), and the answer when the cap is off.
const CAP = { topePeriodo: { horas: 12, valor: 11000, vigenteDesde: "2026-11-15T17:00:00.000Z" } };
const NO_CAP = { topePeriodo: null };
// The spaces (FR-24): without a limit, as in production before the administrator
// sets them, and with the spaces of lot A.
const NO_SPACES = {
  cupos: [
    { tipoVehiculo: "CARRO", cupos: null, ocupados: 0, libres: null },
    { tipoVehiculo: "MOTO", cupos: null, ocupados: 1, libres: null },
  ],
};
const LOT_A = {
  cupos: [
    { tipoVehiculo: "CARRO", cupos: 16, ocupados: 4, libres: 12 },
    { tipoVehiculo: "MOTO", cupos: 300, ocupados: 1, libres: 299 },
  ],
};
const NO_SESSION = { error: { codigo: "NO_AUTENTICADO", mensaje: "No hay una sesión activa." } };
const INTERNAL_ERROR = {
  error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado." },
};

function apiError(codigo: string) {
  return { error: { codigo, mensaje: "Un mensaje de la API que la página no muestra." } };
}

function loaded(cap: object = CAP, spaces: object = NO_SPACES) {
  return [
    jsonResponse(200, RATES),
    jsonResponse(200, GRACE_PERIOD),
    jsonResponse(200, cap),
    jsonResponse(200, spaces),
  ];
}

function renderRates() {
  const onSessionEnded = vi.fn();
  render(<Rates onSessionEnded={onSessionEnded} />);
  return onSessionEnded;
}

// The line with the cap in force, above its fields.
function capStatus() {
  return screen.getByText(/^Tope actual:/).textContent;
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
      "/api/tope-periodo",
      "/api/cupos",
    ]);
    for (const [, init] of fetchMock.mock.calls) expect(init).not.toHaveProperty("credentials");
  });

  it("shows the cap in force and fills its fields (US-16)", async () => {
    stubFetch(...loaded());
    renderRates();

    await screen.findByRole("heading", { name: "Tope por periodo" });
    expect(capStatus()).toBe("Tope actual: $11.000 cada 12 horas");
    expect(screen.getByLabelText("Periodo (horas)")).toHaveProperty("value", "12");
    expect(screen.getByLabelText("Valor máximo por periodo")).toHaveProperty("value", "11000");
  });

  it("shows the cap off, with empty fields", async () => {
    stubFetch(...loaded(NO_CAP));
    renderRates();

    await screen.findByRole("heading", { name: "Tope por periodo" });
    expect(capStatus()).toBe("Tope actual: desactivado");
    expect(screen.getByLabelText("Periodo (horas)")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Valor máximo por periodo")).toHaveProperty("value", "");
  });

  it.each([
    [
      "fails",
      [
        jsonResponse(500, INTERNAL_ERROR),
        jsonResponse(200, GRACE_PERIOD),
        jsonResponse(200, CAP),
        jsonResponse(200, NO_SPACES),
      ],
    ],
    [
      "fails to load the cap",
      [
        jsonResponse(200, RATES),
        jsonResponse(200, GRACE_PERIOD),
        jsonResponse(500, INTERNAL_ERROR),
        jsonResponse(200, NO_SPACES),
      ],
    ],
    [
      "fails to load the spaces",
      [
        jsonResponse(200, RATES),
        jsonResponse(200, GRACE_PERIOD),
        jsonResponse(200, CAP),
        jsonResponse(500, INTERNAL_ERROR),
      ],
    ],
    [
      "cannot be reached",
      [
        new TypeError("Failed to fetch"),
        new TypeError("Failed to fetch"),
        new TypeError("Failed to fetch"),
        new TypeError("Failed to fetch"),
      ],
    ],
  ])("says so in an alert when the server %s", async (_case, answers) => {
    stubFetch(...answers);
    renderRates();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No se pudieron cargar las tarifas.",
    );
  });

  it("goes back to sign in when the session ended (401)", async () => {
    stubFetch(
      jsonResponse(401, NO_SESSION),
      jsonResponse(401, NO_SESSION),
      jsonResponse(401, NO_SESSION),
      jsonResponse(401, NO_SESSION),
    );
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
    const [url, init] = fetchMock.mock.calls[4];
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
    const [url, init] = fetchMock.mock.calls[4];
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
    expect(fetchMock.mock.calls[4][1]?.body).toBe(JSON.stringify({ minutos: null }));
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

describe("saving the cap per period (US-16)", () => {
  it("sends the hours and the value and shows the new cap", async () => {
    const fetchMock = stubFetch(
      ...loaded(NO_CAP),
      jsonResponse(201, {
        topePeriodo: { horas: 1, valor: 1000, vigenteDesde: "2026-11-15T18:00:00.000Z" },
      }),
    );
    const user = userEvent.setup();
    renderRates();

    await user.type(await screen.findByLabelText("Periodo (horas)"), "1");
    await user.type(screen.getByLabelText("Valor máximo por periodo"), "1000");
    expect(screen.queryByRole("button", { name: "Desactivar tope" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Guardar tope" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Tope guardado: $1.000 cada 1 hora.",
    );
    expect(capStatus()).toBe("Tope actual: $1.000 cada 1 hora");
    screen.getByRole("button", { name: "Desactivar tope" });
    const [url, init] = fetchMock.mock.calls[4];
    expect(url).toBe("/api/tope-periodo");
    expect(init).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ horas: 1, valor: 1000 }),
    });
  });

  it("turns the cap off and stops offering to turn it off", async () => {
    const fetchMock = stubFetch(...loaded(), jsonResponse(200, NO_CAP));
    const user = userEvent.setup();
    renderRates();

    await user.click(await screen.findByRole("button", { name: "Desactivar tope" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Tope desactivado: los vehículos que ingresen desde ahora se cobran sin tope.",
    );
    expect(capStatus()).toBe("Tope actual: desactivado");
    expect(screen.queryByRole("button", { name: "Desactivar tope" })).toBeNull();
    const [url, init] = fetchMock.mock.calls[4];
    expect(url).toBe("/api/tope-periodo");
    expect(init?.body).toBe(JSON.stringify({ activo: false }));
  });

  it("sends empty fields as null, so the server rejects them (RI-20)", async () => {
    const fetchMock = stubFetch(...loaded(NO_CAP), jsonResponse(400, apiError("ENTRADA_INVALIDA")));
    const user = userEvent.setup();
    renderRates();

    await user.click(await screen.findByRole("button", { name: "Guardar tope" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "El periodo debe ser de 1 a 24 horas, y el valor, un número entero de pesos entre $1 y $1.000.000.",
    );
    expect(fetchMock.mock.calls[4][1]?.body).toBe(JSON.stringify({ horas: null, valor: null }));
  });

  it("disables both buttons while it waits for the answer", async () => {
    let answer: (response: Response) => void = () => {};
    const fetchMock = stubFetch(...loaded());
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderRates();
    const save = await screen.findByRole("button", { name: "Guardar tope" });
    const turnOff = screen.getByRole("button", { name: "Desactivar tope" });

    await user.click(save);

    expect(save).toHaveProperty("disabled", true);
    expect(turnOff).toHaveProperty("disabled", true);
    answer(jsonResponse(500, INTERNAL_ERROR));
    await screen.findByRole("alert");
    expect(save).toHaveProperty("disabled", false);
    expect(turnOff).toHaveProperty("disabled", false);
  });

  it.each([
    [
      "invalid (RI-20)",
      jsonResponse(400, apiError("ENTRADA_INVALIDA")),
      "El periodo debe ser de 1 a 24 horas, y el valor, un número entero de pesos entre $1 y $1.000.000.",
    ],
    [
      "denied (NFR-05)",
      jsonResponse(403, apiError("ACCESO_DENEGADO")),
      "Solo un administrador puede cambiar las tarifas.",
    ],
    ["failed", jsonResponse(500, INTERNAL_ERROR), "No se pudo guardar. Intenta de nuevo."],
    ["not sent", new TypeError("Failed to fetch"), "No se pudo guardar. Intenta de nuevo."],
  ])("explains a cap %s in an alert and keeps the current cap", async (_case, answer, message) => {
    stubFetch(...loaded(), answer);
    const user = userEvent.setup();
    renderRates();
    const hours = await screen.findByLabelText("Periodo (horas)");

    await user.clear(hours);
    await user.type(hours, "25");
    await user.click(screen.getByRole("button", { name: "Guardar tope" }));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(capStatus()).toBe("Tope actual: $11.000 cada 12 horas");
    expect(hours).toHaveProperty("value", "25");
  });

  it("shows the cap off when someone else turned it off first (409)", async () => {
    stubFetch(...loaded(), jsonResponse(409, apiError("SIN_TOPE_PERIODO")));
    const user = userEvent.setup();
    renderRates();

    await user.click(await screen.findByRole("button", { name: "Desactivar tope" }));

    expect((await screen.findByRole("alert")).textContent).toBe("El tope ya estaba desactivado.");
    expect(capStatus()).toBe("Tope actual: desactivado");
    expect(screen.queryByRole("button", { name: "Desactivar tope" })).toBeNull();
  });

  it("goes back to sign in when the session ended while saving (401)", async () => {
    stubFetch(...loaded(), jsonResponse(401, NO_SESSION));
    const user = userEvent.setup();
    const onSessionEnded = renderRates();

    await user.click(await screen.findByRole("button", { name: "Guardar tope" }));

    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
  });
});

// The cells of the row of a vehicle type in the spaces table.
function spacesRow(vehicle: string) {
  const row = screen.getByRole("cell", { name: vehicle }).closest("tr");
  if (row === null) throw new Error(`no row for ${vehicle}`);
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent)
    .slice(0, 3);
}

describe("spaces of the lot (US-17, BR-19)", () => {
  it("shows the vehicles inside and the spaces of each type, and fills the fields", async () => {
    stubFetch(...loaded(CAP, LOT_A));
    renderRates();

    await screen.findByRole("heading", { name: "Cupos del parqueadero" });
    expect(spacesRow("Carros")).toEqual(["Carros", "4", "16"]);
    expect(spacesRow("Motos")).toEqual(["Motos", "1", "300"]);
    expect(screen.getByLabelText("Nuevos cupos de carros")).toHaveProperty("value", "16");
    expect(screen.getByLabelText("Nuevos cupos de motos")).toHaveProperty("value", "300");
  });

  it("shows a type without a limit, with an empty field", async () => {
    stubFetch(...loaded());
    renderRates();

    await screen.findByRole("heading", { name: "Cupos del parqueadero" });
    expect(spacesRow("Carros")).toEqual(["Carros", "0", "Sin límite"]);
    expect(screen.getByLabelText("Nuevos cupos de carros")).toHaveProperty("value", "");
  });

  it("sends the spaces of a type and shows them as the current ones", async () => {
    const saved = { tipoVehiculo: "CARRO", cupos: 30, ocupados: 0, libres: 30 };
    const fetchMock = stubFetch(...loaded(), jsonResponse(201, saved));
    const user = userEvent.setup();
    renderRates();

    const field = await screen.findByLabelText("Nuevos cupos de carros");
    await user.type(field, "30");
    await user.click(screen.getByRole("button", { name: "Guardar cupos de carros" }));

    expect((await screen.findByRole("status")).textContent).toBe("Cupos de carros guardados: 30.");
    expect(spacesRow("Carros")).toEqual(["Carros", "0", "30"]);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/cupos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoVehiculo: "CARRO", cupos: 30 }),
    });
  });

  it("groups the thousands of the spaces saved", async () => {
    const saved = { tipoVehiculo: "MOTO", cupos: 10000, ocupados: 1, libres: 9999 };
    stubFetch(...loaded(), jsonResponse(201, saved));
    const user = userEvent.setup();
    renderRates();

    await user.type(await screen.findByLabelText("Nuevos cupos de motos"), "10000");
    await user.click(screen.getByRole("button", { name: "Guardar cupos de motos" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Cupos de motos guardados: 10.000.",
    );
    expect(spacesRow("Motos")).toEqual(["Motos", "1", "10.000"]);
  });

  it("removes the limit when the field is empty", async () => {
    const removed = { tipoVehiculo: "MOTO", cupos: null, ocupados: 1, libres: null };
    const fetchMock = stubFetch(...loaded(CAP, LOT_A), jsonResponse(200, removed));
    const user = userEvent.setup();
    renderRates();

    await user.clear(await screen.findByLabelText("Nuevos cupos de motos"));
    await user.click(screen.getByRole("button", { name: "Guardar cupos de motos" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Límite de motos quitado: las motos entran sin límite de cupos.",
    );
    expect(spacesRow("Motos")).toEqual(["Motos", "1", "Sin límite"]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/cupos",
      expect.objectContaining({ body: JSON.stringify({ tipoVehiculo: "MOTO", cupos: null }) }),
    );
  });

  it("disables the buttons while it waits for the answer", async () => {
    const fetchMock = stubFetch(...loaded());
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderRates();

    await user.type(await screen.findByLabelText("Nuevos cupos de carros"), "30");
    await user.click(screen.getByRole("button", { name: "Guardar cupos de carros" }));
    const buttons = ["Guardar cupos de carros", "Guardar cupos de motos"].map(
      (name) => screen.getByRole("button", { name }) as HTMLButtonElement,
    );
    expect(buttons.map((button) => button.disabled)).toEqual([true, true]);

    answer(jsonResponse(201, { tipoVehiculo: "CARRO", cupos: 30, ocupados: 0, libres: 30 }));
    await screen.findByRole("status");
    expect(buttons.map((button) => button.disabled)).toEqual([false, false]);
  });

  it.each([
    [
      "the spaces are not valid (400)",
      jsonResponse(400, apiError("ENTRADA_INVALIDA")),
      "Los cupos deben ser un número entero de 0 a 10.000. Deja el campo vacío para quitar el límite.",
    ],
    [
      "another administrator saved first (409)",
      jsonResponse(409, apiError("CUPOS_CAMBIARON")),
      "Otro administrador cambió los cupos al mismo tiempo. Recarga la página, revisa los valores y vuelve a guardar.",
    ],
    [
      "the user is not an administrator (403)",
      jsonResponse(403, apiError("ACCESO_DENEGADO")),
      "Solo un administrador puede cambiar los cupos.",
    ],
    [
      "the server fails",
      jsonResponse(500, INTERNAL_ERROR),
      "No se pudo guardar. Intenta de nuevo.",
    ],
    [
      "the server cannot be reached",
      new TypeError("Failed to fetch"),
      "No se pudo guardar. Intenta de nuevo.",
    ],
  ])(
    "explains in an alert when %s, and keeps the current spaces",
    async (_case, answer, message) => {
      stubFetch(...loaded(CAP, LOT_A), answer);
      const user = userEvent.setup();
      renderRates();

      const field = await screen.findByLabelText("Nuevos cupos de carros");
      await user.clear(field);
      await user.type(field, "20000");
      await user.click(screen.getByRole("button", { name: "Guardar cupos de carros" }));

      expect((await screen.findByRole("alert")).textContent).toBe(message);
      expect(spacesRow("Carros")).toEqual(["Carros", "4", "16"]);
      expect(field).toHaveProperty("value", "20000");
    },
  );

  it("shows a type without a limit when someone else removed it first (409)", async () => {
    stubFetch(...loaded(CAP, LOT_A), jsonResponse(409, apiError("SIN_CUPOS_CONFIGURADOS")));
    const user = userEvent.setup();
    renderRates();

    await user.clear(await screen.findByLabelText("Nuevos cupos de motos"));
    await user.click(screen.getByRole("button", { name: "Guardar cupos de motos" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Las motos ya no tenían límite de cupos.",
    );
    expect(spacesRow("Motos")).toEqual(["Motos", "1", "Sin límite"]);
  });

  it("goes back to sign in when the session ended while saving (401)", async () => {
    stubFetch(...loaded(), jsonResponse(401, NO_SESSION));
    const user = userEvent.setup();
    const onSessionEnded = renderRates();

    await user.type(await screen.findByLabelText("Nuevos cupos de carros"), "30");
    await user.click(screen.getByRole("button", { name: "Guardar cupos de carros" }));

    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
  });
});

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
// The spaces as the API answers them (FR-24): without spaces, as in production
// before the administrator sets them.
const NO_SPACES = {
  cupos: [
    { tipoVehiculo: "CARRO", cupos: null, ocupados: 0, libres: null },
    { tipoVehiculo: "MOTO", cupos: null, ocupados: 0, libres: null },
  ],
};

// The list of vehicles inside and then the board (BR-19), as the screen asks
// for them when it appears.
function loaded(stays: object, spaces: object = NO_SPACES) {
  return [jsonResponse(200, stays), jsonResponse(200, spaces)];
}
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
    const fetchMock = stubFetch(...loaded(NO_STAYS));
    renderStays();
    await screen.findByText("No hay vehículos dentro.");
    // A relative URL and no credentials (docs/modelo-amenazas.md, 7.3).
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/estadias?estado=ACTIVA");
    expect(init).not.toHaveProperty("credentials");
  });

  it("lists them in the API's order, with the entry time in Bogotá", async () => {
    stubFetch(...loaded({ estadias: [MOTORCYCLE, CAR] }));
    renderStays();
    await screen.findByText("ABC12D");
    expect(rows()).toEqual([
      ["ABC12D", "Moto", "Negro", "—", "10/11 21:24", "Registrar salida"],
      ["ABC123", "Carro", "Rojo", "Mazda", "10/11 21:22", "Registrar salida"],
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

// US-10: the administrator corrects an entry from its row. The page gets the
// role from App.tsx; the API checks it anyway (A-19).
describe("button to correct an entry (US-10)", () => {
  it("shows Corregir next to Registrar salida in each row when the user can correct", async () => {
    stubFetch(...loaded({ estadias: [MOTORCYCLE, CAR] }));
    render(<Stays onSessionEnded={vi.fn()} canCorrect />);
    await screen.findByText("ABC12D");
    expect(rows().map((cells) => cells[5])).toEqual([
      "Registrar salidaCorregir",
      "Registrar salidaCorregir",
    ]);
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeTruthy();
    screen.getByRole("button", { name: "Corregir ingreso de ABC12D" });
    screen.getByRole("button", { name: "Corregir ingreso de ABC123" });
  });

  // Passes from the start, on purpose: an operator never had the button.
  it("shows only Registrar salida when the user cannot correct", async () => {
    stubFetch(...loaded({ estadias: [CAR] }));
    renderStays();
    await screen.findByText("ABC123");
    expect(screen.getByRole("columnheader", { name: "Salida" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Corregir/ })).toBeNull();
  });
});

describe("entry", () => {
  it.each([
    ["no brand as null", "", null],
    ["the brand", "Yamaha", "Yamaha"],
  ])("sends the plate as typed and %s", async (_case, marca, expected) => {
    const fetchMock = stubFetch(
      ...loaded(NO_STAYS),
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
    stubFetch(...loaded({ estadias: [CAR] }), jsonResponse(201, MOTORCYCLE));
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
    const fetchMock = stubFetch(...loaded(NO_STAYS));
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

// A third vehicle whose plate has nothing in common with the other two.
const VAN = {
  id: 9,
  placa: "XYZ789",
  tipoVehiculo: "CARRO",
  color: "Blanco",
  marca: "Renault",
  horaIngreso: "2026-11-11T02:20:00.000Z",
};
const THREE = { estadias: [MOTORCYCLE, CAR, VAN] };

async function search(user: UserEvent, text: string) {
  await user.type(await screen.findByLabelText("Buscar por placa"), text);
}

describe("search by plate", () => {
  it.each([
    ["the whole plate in lowercase", "abc123", ["ABC123"]],
    ["the plate with a hyphen", "ABC-123", ["ABC123"]],
    ["part of the plate with a space", "bc 1", ["ABC12D", "ABC123"]],
    ["the end of a motorcycle plate", "12d", ["ABC12D"]],
    ["only spaces and hyphens", " - ", ["ABC12D", "ABC123", "XYZ789"]],
  ])("filters the list by %s (FR-08, FR-11)", async (_case, text, expected) => {
    stubFetch(...loaded(THREE));
    const user = userEvent.setup();
    renderStays();
    await search(user, text);
    expect(rows().map((cells) => cells[0])).toEqual(expected);
  });

  it("filters the list on screen without asking the API again", async () => {
    const fetchMock = stubFetch(...loaded(THREE));
    const user = userEvent.setup();
    renderStays();
    await search(user, "xyz");
    expect(rows().map((cells) => cells[0])).toEqual(["XYZ789"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a new entry that matches the search", async () => {
    stubFetch(...loaded({ estadias: [CAR, VAN] }), jsonResponse(201, MOTORCYCLE));
    const user = userEvent.setup();
    renderStays();
    await search(user, "abc");
    await registerEntry(user, MOTORCYCLE_ENTRY);
    await screen.findByText("ABC12D");
    expect(rows().map((cells) => cells[0])).toEqual(["ABC12D", "ABC123"]);
  });

  it("says so when no vehicle inside matches, with the plate as searched", async () => {
    stubFetch(...loaded(THREE));
    const user = userEvent.setup();
    renderStays();
    await search(user, "tst-1");
    expect(
      screen.getByText(
        "Ningún vehículo dentro coincide con TST1. Si ya salió, búscalo en Historial.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the whole list again when the field is emptied", async () => {
    stubFetch(...loaded(THREE));
    const user = userEvent.setup();
    renderStays();
    await search(user, "tst");
    await user.clear(screen.getByLabelText("Buscar por placa"));
    expect(rows().map((cells) => cells[0])).toEqual(["ABC12D", "ABC123", "XYZ789"]);
  });

  it("has no search field when there are no vehicles inside", async () => {
    stubFetch(...loaded(NO_STAYS));
    renderStays();
    await screen.findByText("No hay vehículos dentro.");
    expect(screen.queryByLabelText("Buscar por placa")).toBeNull();
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
    stubFetch(...loaded({ estadias: [CAR] }), jsonResponse(status, rejected));
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
    stubFetch(...loaded(NO_STAYS), answer);
    const user = userEvent.setup();
    renderStays();
    await registerEntry(user, MOTORCYCLE_ENTRY);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se pudo registrar el ingreso. Intenta de nuevo.");
    expect(valueOf("Placa")).toBe("abc-12d");
  });
});

// The board as the API answers it: spaces for each type, or null for no limit.
function spaces(cars: number | null, motorcycles: number | null) {
  return {
    cupos: [
      { tipoVehiculo: "CARRO", cupos: cars, ocupados: 0, libres: null },
      { tipoVehiculo: "MOTO", cupos: motorcycles, ocupados: 0, libres: null },
    ],
  };
}

// The lines of the board above the list (BR-19).
async function boardLines() {
  const board = await screen.findByRole("list", { name: "Cupos" });
  return within(board)
    .getAllByRole("listitem")
    .map((line) => line.textContent);
}

describe("board of spaces (BR-19, FR-24)", () => {
  it("asks for the spaces after the list, with the default fetch", async () => {
    const fetchMock = stubFetch(...loaded(NO_STAYS));
    renderStays();
    await boardLines();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/estadias?estado=ACTIVA",
      "/api/cupos",
    ]);
    // A relative URL and no credentials (docs/modelo-amenazas.md, 7.3).
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty("credentials");
  });

  it("shows only the vehicles inside of a type without spaces", async () => {
    stubFetch(...loaded(THREE));
    renderStays();
    expect(await boardLines()).toEqual(["Carros: 2 ocupados", "Motos: 1 ocupado"]);
  });

  it("shows the free spaces, the vehicles inside and the spaces, and Lleno with none left", async () => {
    stubFetch(...loaded(THREE, spaces(3, 1)));
    renderStays();
    expect(await boardLines()).toEqual([
      "Carros: 1 libre · 2 ocupados · 3 cupos",
      "Motos: 0 libres · 1 ocupado · 1 cupo · Lleno",
    ]);
  });

  it("shows 0 free spaces, not fewer, when the spaces are below the vehicles inside", async () => {
    stubFetch(...loaded(THREE, spaces(1, 0)));
    renderStays();
    expect(await boardLines()).toEqual([
      "Carros: 0 libres · 2 ocupados · 1 cupo · Lleno",
      "Motos: 0 libres · 1 ocupado · 0 cupos · Lleno",
    ]);
  });

  it("groups the thousands", async () => {
    stubFetch(...loaded({ estadias: [MOTORCYCLE] }, spaces(null, 10000)));
    renderStays();
    expect(await boardLines()).toEqual([
      "Carros: 0 ocupados",
      "Motos: 9.999 libres · 1 ocupado · 10.000 cupos",
    ]);
  });

  it("counts a new entry without asking the API again", async () => {
    const fetchMock = stubFetch(
      ...loaded({ estadias: [CAR] }, spaces(2, 5)),
      jsonResponse(201, VAN),
    );
    const user = userEvent.setup();
    renderStays();
    await registerEntry(user, { placa: "xyz789", tipo: "Carro", color: "Blanco", marca: "" });
    await screen.findByText("XYZ789");
    expect(await boardLines()).toEqual([
      "Carros: 0 libres · 2 ocupados · 2 cupos · Lleno",
      "Motos: 5 libres · 0 ocupados · 5 cupos",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("says so when the board cannot be loaded, and still shows the list", async () => {
    stubFetch(jsonResponse(200, { estadias: [CAR] }), jsonResponse(500, INTERNAL_ERROR));
    renderStays();
    await screen.findByText("No se pudo cargar el marcador de cupos.");
    expect(rows().map((cells) => cells[0])).toEqual(["ABC123"]);
  });

  it("goes back to sign in when the session ended before the board", async () => {
    stubFetch(
      jsonResponse(200, { estadias: [CAR] }),
      jsonResponse(401, { error: { codigo: "NO_AUTENTICADO", mensaje: "No hay sesión." } }),
    );
    const onSessionEnded = vi.fn();
    render(<Stays onSessionEnded={onSessionEnded} />);
    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
  });
});

describe("entry rejected because no spaces are left (BR-19)", () => {
  const NO_SPACE_LEFT = {
    error: { codigo: "SIN_CUPO", mensaje: "No quedan cupos para ese tipo de vehículo." },
  };

  it.each([
    ["carros", { placa: "xyz789", tipo: "Carro", color: "Blanco", marca: "" }],
    ["motos", MOTORCYCLE_ENTRY],
  ])(
    "says no more %s can enter, keeps the form and asks for the list and the board again",
    async (vehicles, entry) => {
      // Another operator registered VAN, which this screen did not show yet.
      const fetchMock = stubFetch(
        ...loaded({ estadias: [CAR] }, spaces(2, 0)),
        jsonResponse(409, NO_SPACE_LEFT),
        ...loaded({ estadias: [CAR, VAN] }, spaces(2, 0)),
      );
      const user = userEvent.setup();
      renderStays();
      await registerEntry(user, entry);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(
        `No se pueden registrar más ingresos de ${vehicles}: no quedan cupos. Contacta al administrador.`,
      );
      await screen.findByText("XYZ789");
      expect(await boardLines()).toEqual([
        "Carros: 0 libres · 2 ocupados · 2 cupos · Lleno",
        "Motos: 0 libres · 0 ocupados · 0 cupos · Lleno",
      ]);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        "/api/estadias?estado=ACTIVA",
        "/api/cupos",
        "/api/estadias",
        "/api/estadias?estado=ACTIVA",
        "/api/cupos",
      ]);
      expect(valueOf("Placa")).toBe(entry.placa);
    },
  );
});

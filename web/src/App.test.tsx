import { render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App.tsx";
import { jsonResponse, stubFetch } from "./test-helpers.ts";

// The API's answers (ADR 0008). findBy* and getBy* fail when the element is
// missing, so they are assertions too.
const ACTIVE_SESSION = {
  usuario: { id: 1, nombre: "Ana Pérez", rol: "ADMINISTRADOR", debeCambiarContrasena: true },
};
const NO_SESSION = { error: { codigo: "NO_AUTENTICADO", mensaje: "No hay una sesión activa." } };
const WRONG_CREDENTIALS = {
  error: { codigo: "NO_AUTENTICADO", mensaje: "Correo o contraseña incorrectos." },
};
const INTERNAL_ERROR = {
  error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado." },
};
// Once signed in, the page asks for the vehicles inside and then for the board
// of spaces (Stays.tsx), without spaces as in production before the
// administrator sets them.
const NO_STAYS = { estadias: [] };
const NO_SPACES = {
  cupos: [
    { tipoVehiculo: "CARRO", cupos: null, ocupados: 0, libres: null },
    { tipoVehiculo: "MOTO", cupos: null, ocupados: 0, libres: null },
  ],
};

describe("on load", () => {
  it("shows the sign-in form when there is no active session", async () => {
    const fetchMock = stubFetch(jsonResponse(401, NO_SESSION));
    render(<App />);
    await screen.findByRole("button", { name: "Iniciar sesión" });
    screen.getByLabelText("Correo");
    screen.getByLabelText("Contraseña");
    // GET /api/sesion with a relative URL and the default fetch
    // (docs/modelo-amenazas.md, 7.3).
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sesion");
    expect(init).not.toHaveProperty("credentials");
  });

  it("shows the user and the sign-out button when a session is active", async () => {
    stubFetch(
      jsonResponse(200, ACTIVE_SESSION),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
    );
    render(<App />);
    await screen.findByText("Sesión iniciada: Ana Pérez");
    screen.getByRole("button", { name: "Cerrar sesión" });
    expect(screen.queryByLabelText("Correo")).toBeNull();
  });

  it.each([
    ["fails", jsonResponse(500, INTERNAL_ERROR)],
    ["cannot be reached", new TypeError("Failed to fetch")],
  ])("says so when the server %s", async (_case, answer) => {
    stubFetch(answer);
    render(<App />);
    await screen.findByText("No se pudo conectar con el servidor.");
  });
});

// Fills in the form and submits it, as a person would.
async function signIn(user: UserEvent) {
  await user.type(await screen.findByLabelText("Correo"), "ana@rolopark.com");
  await user.type(screen.getByLabelText("Contraseña"), "una contraseña de prueba");
  await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
}

describe("sign in", () => {
  it("sends the email and password and shows the user", async () => {
    const fetchMock = stubFetch(
      jsonResponse(401, NO_SESSION),
      jsonResponse(200, ACTIVE_SESSION),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
    );
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await screen.findByText("Sesión iniciada: Ana Pérez");
    // POST /api/sesion in JSON, with a relative URL and the default fetch.
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/sesion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "ana@rolopark.com", contrasena: "una contraseña de prueba" }),
    });
  });

  it("says the email or password is wrong when the API answers 401", async () => {
    stubFetch(jsonResponse(401, NO_SESSION), jsonResponse(401, WRONG_CREDENTIALS));
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Correo o contraseña incorrectos.");
    screen.getByRole("button", { name: "Iniciar sesión" });
  });

  it.each([
    ["fails", jsonResponse(500, INTERNAL_ERROR)],
    ["cannot be reached", new TypeError("Failed to fetch")],
  ])("shows a general error when the server %s", async (_case, answer) => {
    stubFetch(jsonResponse(401, NO_SESSION), answer);
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se pudo iniciar sesión. Intenta de nuevo.");
  });
});

describe("sign out", () => {
  it("ends the session and shows the sign-in form again", async () => {
    const signedOut = new Response(null, { status: 204 });
    const fetchMock = stubFetch(
      jsonResponse(200, ACTIVE_SESSION),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
      signedOut,
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    await screen.findByRole("button", { name: "Iniciar sesión" });
    // DELETE /api/sesion with a relative URL and the default fetch.
    expect(fetchMock).toHaveBeenLastCalledWith("/api/sesion", { method: "DELETE" });
  });

  it.each([
    ["fails", jsonResponse(500, INTERNAL_ERROR)],
    ["cannot be reached", new TypeError("Failed to fetch")],
  ])("keeps the session and says so when the server %s", async (_case, answer) => {
    stubFetch(
      jsonResponse(200, ACTIVE_SESSION),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
      answer,
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se pudo cerrar la sesión. Intenta de nuevo.");
    screen.getByText("Sesión iniciada: Ana Pérez");
  });
});

describe("stays screen", () => {
  const ONE_CAR = {
    estadias: [
      {
        id: 7,
        placa: "ABC123",
        tipoVehiculo: "CARRO",
        color: "Rojo",
        marca: "Mazda",
        horaIngreso: "2026-11-11T02:22:00.000Z",
      },
    ],
  };

  it("shows the vehicles inside once signed in", async () => {
    stubFetch(
      jsonResponse(200, ACTIVE_SESSION),
      jsonResponse(200, ONE_CAR),
      jsonResponse(200, NO_SPACES),
    );
    render(<App />);
    await screen.findByText("ABC123");
  });

  // US-10 and matrix 1.2: only an administrator corrects an entry. The API checks
  // the role anyway (A-19). The operator's case passes from the start, on purpose.
  it.each([
    ["an administrator", "ADMINISTRADOR", 1],
    ["an operator", "OPERADOR", 0],
  ])("shows Corregir only to an administrator: %s", async (_case, rol, buttons) => {
    stubFetch(
      jsonResponse(200, { usuario: { ...ACTIVE_SESSION.usuario, rol } }),
      jsonResponse(200, ONE_CAR),
      jsonResponse(200, NO_SPACES),
    );
    render(<App />);
    await screen.findByText("ABC123");
    const correct = screen.queryAllByRole("button", { name: "Corregir ingreso de ABC123" });
    expect(correct).toHaveLength(buttons);
  });

  // The session expires after 30 minutes without use (US-01).
  it("goes back to the sign-in form when the session ended before the list", async () => {
    stubFetch(jsonResponse(200, ACTIVE_SESSION), jsonResponse(401, NO_SESSION));
    render(<App />);
    await screen.findByRole("button", { name: "Iniciar sesión" });
  });

  it("goes back to the sign-in form when the session ended before an entry", async () => {
    stubFetch(
      jsonResponse(200, ACTIVE_SESSION),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
      jsonResponse(401, NO_SESSION),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Placa"), "ABC123");
    await user.type(screen.getByLabelText("Color"), "Rojo");
    await user.click(screen.getByRole("button", { name: "Registrar ingreso" }));
    await screen.findByRole("button", { name: "Iniciar sesión" });
  });
});

describe("sections (matrix 1.2)", () => {
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
        valorMinuto: 161,
        topeLegal: 161,
        vigenteDesde: "2026-11-07T17:35:00.000Z",
      },
    ],
  };
  const GRACE_PERIOD = { minutos: 5, vigenteDesde: "2026-11-07T17:35:00.000Z" };
  const NO_CAP = { topePeriodo: null };

  it("lets an administrator switch between Operación and Tarifas", async () => {
    stubFetch(
      jsonResponse(200, ACTIVE_SESSION),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
      jsonResponse(200, RATES),
      jsonResponse(200, GRACE_PERIOD),
      jsonResponse(200, NO_CAP),
      jsonResponse(200, NO_SPACES),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
    );
    const user = userEvent.setup();
    render(<App />);
    const sections = await screen.findByRole("navigation", { name: "Secciones" });
    const operation = within(sections).getByRole("button", { name: "Operación" });
    const rates = within(sections).getByRole("button", { name: "Tarifas" });
    expect(operation.getAttribute("aria-current")).toBe("page");
    await screen.findByText("No hay vehículos dentro.");

    await user.click(rates);

    await screen.findByRole("heading", { name: "Tarifa por minuto" });
    expect(rates.getAttribute("aria-current")).toBe("page");
    expect(operation.getAttribute("aria-current")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Registrar ingreso" })).toBeNull();

    await user.click(operation);

    await screen.findByRole("heading", { name: "Registrar ingreso" });
    expect(screen.queryByRole("heading", { name: "Tarifa por minuto" })).toBeNull();
  });

  it("shows an administrator Operación, Historial, Tarifas and Cuentas", async () => {
    stubFetch(
      jsonResponse(200, ACTIVE_SESSION),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
      jsonResponse(200, { usuarios: [] }),
    );
    const user = userEvent.setup();
    render(<App />);

    const sections = await screen.findByRole("navigation", { name: "Secciones" });
    const names = within(sections)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["Operación", "Historial", "Tarifas", "Cuentas"]);
    await screen.findByText("No hay vehículos dentro.");

    await user.click(within(sections).getByRole("button", { name: "Cuentas" }));

    await screen.findByRole("heading", { name: "Crear cuenta de operador" });
    expect(screen.queryByRole("heading", { name: "Registrar ingreso" })).toBeNull();
  });

  // FR-15 and matrix 1.2: only an administrator voids a stay, from History. The
  // API checks the role anyway (A-19). The operator's case passes from the start,
  // on purpose.
  it.each([
    ["an administrator", "ADMINISTRADOR", 1],
    ["an operator", "OPERADOR", 0],
  ])("shows Anular in History only to an administrator: %s", async (_case, rol, buttons) => {
    const closed = {
      id: 30,
      placa: "TST130",
      tipoVehiculo: "CARRO",
      color: "Azul",
      marca: null,
      horaIngreso: "2026-11-16T00:42:22.000Z",
      horaSalida: "2026-11-16T00:47:26.000Z",
      estado: "CERRADA",
      comprobante: { consecutivo: 8, total: 1350 },
    };
    stubFetch(
      jsonResponse(200, { usuario: { ...ACTIVE_SESSION.usuario, rol } }),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
      jsonResponse(200, { estadias: [closed], hayMas: false }),
    );
    const user = userEvent.setup();
    render(<App />);
    const sections = await screen.findByRole("navigation", { name: "Secciones" });
    await screen.findByText("No hay vehículos dentro.");
    await user.click(within(sections).getByRole("button", { name: "Historial" }));
    await screen.findByText("TST130");
    const voidButtons = screen.queryAllByRole("button", { name: "Anular estadía de TST130" });
    expect(voidButtons).toHaveLength(buttons);
  });

  // Requirements 1.3, decision 5: the operator also reads the history.
  it("lets an operator switch between Operación and Historial, without Tarifas", async () => {
    stubFetch(
      jsonResponse(200, { usuario: { ...ACTIVE_SESSION.usuario, rol: "OPERADOR" } }),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
      jsonResponse(200, { estadias: [], hayMas: false }),
      jsonResponse(200, NO_STAYS),
      jsonResponse(200, NO_SPACES),
    );
    const user = userEvent.setup();
    render(<App />);
    const sections = await screen.findByRole("navigation", { name: "Secciones" });
    const names = within(sections)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["Operación", "Historial"]);
    await screen.findByText("No hay vehículos dentro.");

    await user.click(within(sections).getByRole("button", { name: "Historial" }));

    await screen.findByRole("heading", { name: "Historial" });
    expect(screen.queryByRole("heading", { name: "Registrar ingreso" })).toBeNull();

    await user.click(within(sections).getByRole("button", { name: "Operación" }));

    await screen.findByRole("heading", { name: "Registrar ingreso" });
    expect(screen.queryByRole("heading", { name: "Historial" })).toBeNull();
  });
});

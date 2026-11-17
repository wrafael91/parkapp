import { render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Accounts from "./Accounts.tsx";
import { jsonResponse, stubFetch } from "./test-helpers.ts";

// Accounts as the API answers them (ADR 0008).
const ADMIN = {
  id: 1,
  nombre: "William Manchabajoy",
  correo: "admin@example.com",
  rol: "ADMINISTRADOR",
  activa: true,
  creadaEn: "2026-11-07T03:20:00.000Z",
};
const OPERATOR = {
  id: 7,
  nombre: "Operadora de prueba",
  correo: "operadora@example.com",
  rol: "OPERADOR",
  activa: true,
  creadaEn: "2026-11-17T01:30:00.000Z",
};
const INACTIVE = {
  id: 8,
  nombre: "Operador anterior",
  correo: "anterior@example.com",
  rol: "OPERADOR",
  activa: false,
  creadaEn: "2026-11-16T15:00:00.000Z",
};
const USERS = { usuarios: [ADMIN, OPERATOR, INACTIVE] };
const NEW = {
  id: 9,
  nombre: "Jurado",
  correo: "jurado@example.com",
  rol: "OPERADOR",
  activa: true,
  creadaEn: "2026-11-17T02:00:00.000Z",
};

function apiError(codigo: string) {
  return { error: { codigo, mensaje: "Un mensaje de la API que la página no muestra." } };
}

function renderAccounts(onSessionEnded = vi.fn()) {
  render(<Accounts onSessionEnded={onSessionEnded} />);
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

async function fillAccount(user: UserEvent) {
  await user.type(await screen.findByLabelText("Nombre"), "Jurado");
  await user.type(screen.getByLabelText("Correo"), "jurado@example.com");
  await user.type(screen.getByLabelText("Contraseña inicial"), "la contraseña del jurado");
}

describe("account list (US-02, US-03)", () => {
  it("shows each account, with a button only for operators", async () => {
    const fetchMock = stubFetch(jsonResponse(200, USERS));
    renderAccounts();
    await screen.findByText("operadora@example.com");
    // A relative URL and no credentials (docs/modelo-amenazas.md, 7.3).
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/usuarios");
    expect(init).not.toHaveProperty("credentials");
    expect(rows()).toEqual([
      ["William Manchabajoy", "admin@example.com", "Administrador", "Activa", "06/11/2026", ""],
      [
        "Operadora de prueba",
        "operadora@example.com",
        "Operador",
        "Activa",
        "16/11/2026",
        "Desactivar",
      ],
      [
        "Operador anterior",
        "anterior@example.com",
        "Operador",
        "Inactiva",
        "16/11/2026",
        "Reactivar",
      ],
    ]);
  });

  it.each([
    ["fails", jsonResponse(500, apiError("ERROR_INTERNO"))],
    ["cannot be reached", new TypeError("Failed to fetch")],
  ])("says so when the server %s", async (_case, answer) => {
    stubFetch(answer);
    renderAccounts();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se pudieron cargar las cuentas.");
  });

  it("goes back to sign in when the session ended", async () => {
    const onSessionEnded = vi.fn();
    stubFetch(jsonResponse(401, apiError("NO_AUTENTICADO")));
    renderAccounts(onSessionEnded);
    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
  });
});

describe("create an operator account (US-02)", () => {
  it("sends the data, adds the account and empties the form", async () => {
    const fetchMock = stubFetch(jsonResponse(200, USERS), jsonResponse(201, NEW));
    const user = userEvent.setup();
    renderAccounts();
    await fillAccount(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(
      "Cuenta creada: jurado@example.com. Entrégale la contraseña inicial en persona.",
    );
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/usuarios");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      nombre: "Jurado",
      correo: "jurado@example.com",
      contrasena: "la contraseña del jurado",
    });
    expect(rows().map((cells) => cells[1])).toEqual([
      "admin@example.com",
      "operadora@example.com",
      "anterior@example.com",
      "jurado@example.com",
    ]);
    expect((screen.getByLabelText("Contraseña inicial") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("");
  });

  it("shows the password only while Mostrar contraseña is checked", async () => {
    stubFetch(jsonResponse(200, USERS));
    const user = userEvent.setup();
    renderAccounts();
    const password = (await screen.findByLabelText("Contraseña inicial")) as HTMLInputElement;
    expect(password.type).toBe("password");
    await user.click(screen.getByLabelText("Mostrar contraseña"));
    expect(password.type).toBe("text");
    await user.click(screen.getByLabelText("Mostrar contraseña"));
    expect(password.type).toBe("password");
  });

  it.each([
    [
      "the email is in use",
      jsonResponse(409, apiError("CORREO_EN_USO")),
      "Ya existe una cuenta con ese correo.",
    ],
    [
      "the data is rejected",
      jsonResponse(400, apiError("ENTRADA_INVALIDA")),
      "Revisa los datos: el nombre de 1 a 100 caracteres, un correo válido y una contraseña de 15 a 64 caracteres.",
    ],
    [
      "the server fails",
      jsonResponse(500, apiError("ERROR_INTERNO")),
      "No se pudo crear la cuenta. Intenta de nuevo.",
    ],
    [
      "the server cannot be reached",
      new TypeError("Failed to fetch"),
      "No se pudo crear la cuenta. Intenta de nuevo.",
    ],
  ])("says so when %s, and keeps the form", async (_case, answer, message) => {
    stubFetch(jsonResponse(200, USERS), answer);
    const user = userEvent.setup();
    renderAccounts();
    await fillAccount(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    expect((screen.getByLabelText("Correo") as HTMLInputElement).value).toBe("jurado@example.com");
    expect(rows()).toHaveLength(3);
  });

  it("goes back to sign in when the session ended while creating", async () => {
    const onSessionEnded = vi.fn();
    stubFetch(jsonResponse(200, USERS), jsonResponse(401, apiError("NO_AUTENTICADO")));
    const user = userEvent.setup();
    renderAccounts(onSessionEnded);
    await fillAccount(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
  });
});

describe("deactivate and reactivate an operator account (US-03)", () => {
  it("deactivates an operator and shows the new state", async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, USERS),
      jsonResponse(200, { ...OPERATOR, activa: false }),
    );
    const user = userEvent.setup();
    renderAccounts();
    await user.click(
      await screen.findByRole("button", { name: "Desactivar operadora@example.com" }),
    );

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(
      "Cuenta desactivada: operadora@example.com. Sus sesiones se cerraron.",
    );
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/usuarios/7/estado");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ activa: false });
    expect(rows()[1].slice(3)).toEqual(["Inactiva", "16/11/2026", "Reactivar"]);
  });

  it("reactivates an operator", async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, USERS),
      jsonResponse(200, { ...INACTIVE, activa: true }),
    );
    const user = userEvent.setup();
    renderAccounts();
    await user.click(await screen.findByRole("button", { name: "Reactivar anterior@example.com" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Cuenta reactivada: anterior@example.com.");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ activa: true });
    expect(rows()[2].slice(3, 4)).toEqual(["Activa"]);
  });

  it("disables the button while waiting", async () => {
    let answer: (response: Response) => void = () => {};
    const fetchMock = stubFetch(jsonResponse(200, USERS));
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderAccounts();
    const button = await screen.findByRole("button", { name: "Desactivar operadora@example.com" });
    await user.click(button);

    expect((button as HTMLButtonElement).disabled).toBe(true);
    answer(jsonResponse(200, { ...OPERATOR, activa: false }));
    expect(
      await screen.findByRole("button", { name: "Reactivar operadora@example.com" }),
    ).toHaveProperty("disabled", false);
  });

  it("shows the real state when the account was already in that state", async () => {
    stubFetch(jsonResponse(200, USERS), jsonResponse(409, apiError("CUENTA_YA_EN_ESE_ESTADO")));
    const user = userEvent.setup();
    renderAccounts();
    await user.click(
      await screen.findByRole("button", { name: "Desactivar operadora@example.com" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("La cuenta ya estaba en ese estado.");
    expect(rows()[1][3]).toBe("Inactiva");
  });

  it.each([
    [
      "the account no longer exists",
      jsonResponse(404, apiError("NO_ENCONTRADO")),
      "La cuenta ya no existe.",
    ],
    [
      "the server fails",
      jsonResponse(500, apiError("ERROR_INTERNO")),
      "No se pudo cambiar el estado de la cuenta. Intenta de nuevo.",
    ],
    [
      "the server cannot be reached",
      new TypeError("Failed to fetch"),
      "No se pudo cambiar el estado de la cuenta. Intenta de nuevo.",
    ],
  ])("says so when %s, and keeps the state", async (_case, answer, message) => {
    stubFetch(jsonResponse(200, USERS), answer);
    const user = userEvent.setup();
    renderAccounts();
    await user.click(
      await screen.findByRole("button", { name: "Desactivar operadora@example.com" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(rows()[1][3]).toBe("Activa");
  });

  it("goes back to sign in when the session ended while changing a state", async () => {
    const onSessionEnded = vi.fn();
    stubFetch(jsonResponse(200, USERS), jsonResponse(401, apiError("NO_AUTENTICADO")));
    const user = userEvent.setup();
    renderAccounts(onSessionEnded);
    await user.click(
      await screen.findByRole("button", { name: "Desactivar operadora@example.com" }),
    );
    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
  });
});

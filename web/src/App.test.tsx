import { render, screen } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App.tsx";

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Replaces fetch with one answer per call, in order. An Error is a network
// failure (fetch rejects).
function stubFetch(...answers: (Response | Error)[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const answer of answers) {
    if (answer instanceof Error) fetchMock.mockRejectedValueOnce(answer);
    else fetchMock.mockResolvedValueOnce(answer);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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
    stubFetch(jsonResponse(200, ACTIVE_SESSION));
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
    const fetchMock = stubFetch(jsonResponse(401, NO_SESSION), jsonResponse(200, ACTIVE_SESSION));
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await screen.findByText("Sesión iniciada: Ana Pérez");
    // POST /api/sesion in JSON, with a relative URL and the default fetch.
    expect(fetchMock).toHaveBeenLastCalledWith("/api/sesion", {
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
    const fetchMock = stubFetch(jsonResponse(200, ACTIVE_SESSION), signedOut);
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
    stubFetch(jsonResponse(200, ACTIVE_SESSION), answer);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se pudo cerrar la sesión. Intenta de nuevo.");
    screen.getByText("Sesión iniciada: Ana Pérez");
  });
});

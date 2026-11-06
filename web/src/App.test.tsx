import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App.tsx";

// The API's answers (ADR 0008). findBy* and getBy* fail when the element is
// missing, so they are assertions too.
const ACTIVE_SESSION = {
  usuario: { id: 1, nombre: "Ana Pérez", rol: "ADMINISTRADOR", debeCambiarContrasena: true },
};
const NO_SESSION = { error: { codigo: "NO_AUTENTICADO", mensaje: "No hay una sesión activa." } };
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

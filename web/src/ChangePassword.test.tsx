import { render, screen } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ChangePassword from "./ChangePassword.tsx";
import { jsonResponse, stubFetch } from "./test-helpers.ts";

const CURRENT = "la contraseña que me asignaron";
const NEW = "una frase de paso que solo yo conozco";
// POST /api/sesion/contrasena answers with the user of the session (ADR 0008).
const CHANGED = {
  usuario: { id: 7, nombre: "Ana Pérez", rol: "OPERADOR", debeCambiarContrasena: false },
};

function apiError(codigo: string) {
  return { error: { codigo, mensaje: "Un mensaje de la API que la página no muestra." } };
}

function renderForm(mandatory = false) {
  const onChanged = vi.fn();
  const onSessionEnded = vi.fn();
  render(
    <ChangePassword mandatory={mandatory} onChanged={onChanged} onSessionEnded={onSessionEnded} />,
  );
  return { onChanged, onSessionEnded };
}

function field(name: string): HTMLInputElement {
  return screen.getByLabelText(name);
}

// Fills in the form and submits it, as a person would.
async function submit(user: UserEvent, confirmation = NEW) {
  await user.type(field("Contraseña actual"), CURRENT);
  await user.type(field("Contraseña nueva"), NEW);
  await user.type(field("Repite la contraseña nueva"), confirmation);
  await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
}

describe("ChangePassword (US-05)", () => {
  it("asks for the current password and the new one twice", () => {
    renderForm();
    screen.getByRole("heading", { name: "Cambiar contraseña" });
    for (const name of ["Contraseña actual", "Contraseña nueva", "Repite la contraseña nueva"]) {
      expect(field(name).type).toBe("password");
      expect(field(name).required).toBe(true);
      expect(field(name).maxLength).toBe(64);
    }
    expect(field("Contraseña actual").autocomplete).toBe("current-password");
    expect(field("Contraseña nueva").autocomplete).toBe("new-password");
    screen.getByText("De 15 a 64 caracteres, distinta de la actual.");
  });

  it.each([
    ["says why when the change is mandatory (RI-16)", true, 1],
    ["does not when the user chose to change it", false, 0],
  ])("%s", (_case, mandatory, count) => {
    renderForm(mandatory);
    const reason = screen.queryAllByText(
      "Tu contraseña fue asignada por otra persona. Cámbiala para continuar.",
    );
    expect(reason).toHaveLength(count);
  });

  it("shows the passwords when asked", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByLabelText("Mostrar contraseñas"));
    for (const name of ["Contraseña actual", "Contraseña nueva", "Repite la contraseña nueva"]) {
      expect(field(name).type).toBe("text");
    }
  });

  it("sends the current and the new password, and says it changed", async () => {
    const fetchMock = stubFetch(jsonResponse(200, CHANGED));
    const user = userEvent.setup();
    const { onChanged } = renderForm(true);

    await submit(user);

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Contraseña cambiada. Tus otras sesiones se cerraron.");
    // A relative URL and the default fetch (docs/modelo-amenazas.md, 7.3); the
    // confirmation does not leave the page.
    expect(fetchMock).toHaveBeenCalledWith("/api/sesion/contrasena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actual: CURRENT, nueva: NEW }),
    });
    expect(onChanged).toHaveBeenCalledWith(CHANGED.usuario);
    expect(field("Contraseña actual").value).toBe("");
    expect(field("Contraseña nueva").value).toBe("");
    expect(field("Repite la contraseña nueva").value).toBe("");
  });

  it("waits for the answer with the button disabled", async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    const user = userEvent.setup();
    renderForm();

    await submit(user);

    const button = screen.getByRole("button", { name: "Cambiar contraseña" });
    expect(button.hasAttribute("disabled")).toBe(true);
    answer(jsonResponse(200, CHANGED));
    await screen.findByRole("status");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("does not send new passwords that do not match", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    const { onChanged } = renderForm();

    await submit(user, `${NEW}.`);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Las contraseñas nuevas no coinciden.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a wrong current password",
      jsonResponse(400, apiError("CONTRASENA_ACTUAL_INCORRECTA")),
      "La contraseña actual no es correcta.",
    ],
    [
      "the same password",
      jsonResponse(400, apiError("CONTRASENA_REPETIDA")),
      "La contraseña nueva debe ser distinta de la actual.",
    ],
    [
      "a short or long new password",
      jsonResponse(400, apiError("ENTRADA_INVALIDA")),
      "La contraseña nueva debe tener de 15 a 64 caracteres.",
    ],
    [
      "a server error",
      jsonResponse(500, apiError("ERROR_INTERNO")),
      "No se pudo cambiar la contraseña. Intenta de nuevo.",
    ],
    [
      "a server that cannot be reached",
      new TypeError("Failed to fetch"),
      "No se pudo cambiar la contraseña. Intenta de nuevo.",
    ],
  ])("explains %s and keeps what was typed", async (_case, answer, message) => {
    stubFetch(answer);
    const user = userEvent.setup();
    const { onChanged } = renderForm();

    await submit(user);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(onChanged).not.toHaveBeenCalled();
    expect(field("Contraseña nueva").value).toBe(NEW);
  });

  it("goes back to sign in when the session ended", async () => {
    stubFetch(jsonResponse(401, apiError("NO_AUTENTICADO")));
    const user = userEvent.setup();
    const { onChanged, onSessionEnded } = renderForm();

    await submit(user);

    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });
});

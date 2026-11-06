import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler, notFound } from "./errors.js";

describe("notFound and errorHandler (ADR 0008, NFR-07)", () => {
  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.get("/falla", () => {
      throw new Error('relation "usuario" does not exist');
    });
    app.use(notFound);
    app.use(errorHandler);
    return app;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers an unknown route with 404 NO_ENCONTRADO in JSON", async () => {
    const response = await request(createTestApp()).post("/no-existe");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { codigo: "NO_ENCONTRADO", mensaje: "El recurso no existe." },
    });
  });

  it("answers malformed JSON with 400 ENTRADA_INVALIDA", async () => {
    const response = await request(createTestApp())
      .post("/no-existe")
      .set("Content-Type", "application/json")
      .send('{"correo":');

    expect(response.status).toBe(400);
    expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
  });

  it("answers an unexpected error with 500 ERROR_INTERNO and logs the detail only on the server", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(createTestApp()).get("/falla");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado." },
    });
    expect(response.text).not.toContain("relation");
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0].join(" ")).toContain('relation "usuario"');
  });
});

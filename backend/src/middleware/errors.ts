import type { ErrorRequestHandler, RequestHandler, Response } from "express";

// The single error shape of the API (ADR 0008): a stable code for the web app
// and the tests, and a message for the user without internal details (NFR-07).
export function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { codigo: code, mensaje: message } });
}

// Replaces Express's HTML page ("Cannot POST ...") for routes that do not exist.
export const notFound: RequestHandler = (_req, res) => {
  sendError(res, 404, "NO_ENCONTRADO", "El recurso no existe.");
};

// Errors from express.json (malformed JSON, a body over the limit) carry a 4xx
// status: the request is invalid. Anything else is a bug or an outage: the
// detail goes only to the server log (NFR-07).
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const status: unknown = error?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    sendError(res, 400, "ENTRADA_INVALIDA", "Los datos enviados no son válidos.");
    return;
  }
  console.error("Unhandled error", error);
  sendError(res, 500, "ERROR_INTERNO", "Ocurrió un error inesperado.");
};

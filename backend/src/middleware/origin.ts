// Allowed origin for requests that change data (docs/modelo-amenazas.md, 7.3;
// ADR 0003). `new URL(raw).origin` normalizes the value, so comparing it with
// the raw text rejects a trailing slash, a path, uppercase letters and a
// default port: the browser sends the origin exactly in that normalized form.
import type { RequestHandler } from "express";

export function parseOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid APP_ORIGIN: ${JSON.stringify(raw)}`);
  }
  const isHttp = url.protocol === "https:" || url.protocol === "http:";
  if (!isHttp || url.origin !== raw) {
    throw new Error(`Invalid APP_ORIGIN: ${JSON.stringify(raw)}`);
  }
  return raw;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// CSRF protection, together with the SameSite=Strict cookie (ADR 0003;
// docs/modelo-amenazas.md, 7.3). Every request that may change data must carry
// an Origin header equal to the allowed origin. A missing Origin, "null" or any
// other value is rejected, without comparing prefixes and without falling back
// to Referer. GET requests never change data (ADR 0008), so they are not checked.
export function requireAllowedOrigin(allowedOrigin: string): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || req.get("Origin") === allowedOrigin) {
      next();
      return;
    }
    // Server log only, not the audit log: there may be no user yet. The path
    // leaves out the query string, and JSON.stringify escapes line breaks.
    console.warn(
      `Rejected ${req.method} ${req.path} from origin ${JSON.stringify(req.get("Origin") ?? null)}`,
    );
    res.status(403).json({
      error: {
        codigo: "ORIGEN_NO_PERMITIDO",
        mensaje: "La petición no proviene de la aplicación.",
      },
    });
  };
}

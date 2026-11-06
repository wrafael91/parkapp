// Allowed origin for requests that change data (docs/modelo-amenazas.md, 7.3;
// ADR 0003). `new URL(raw).origin` normalizes the value, so comparing it with
// the raw text rejects a trailing slash, a path, uppercase letters and a
// default port: the browser sends the origin exactly in that normalized form.
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

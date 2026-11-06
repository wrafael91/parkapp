// Session cookie (ADR 0003; docs/modelo-amenazas.md, 7.2).
export const SESSION_COOKIE = "sesion";

const PREFIX = `${SESSION_COOKIE}=`;

// Reads the token from the Cookie header without a parsing library: the token
// is base64url, so it needs no decoding. Returns null if there is none.
export function readSessionToken(cookieHeader: string | undefined): string | null {
  for (const part of cookieHeader?.split(";") ?? []) {
    const cookie = part.trim();
    if (cookie.startsWith(PREFIX)) {
      return cookie.slice(PREFIX.length) || null;
    }
  }
  return null;
}

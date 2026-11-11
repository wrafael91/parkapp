import { vi } from "vitest";

// Shared by the tests of the page. An API answer in JSON (ADR 0008).
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Replaces fetch with one answer per call, in order. An Error is a network
// failure (fetch rejects).
export function stubFetch(...answers: (Response | Error)[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const answer of answers) {
    if (answer instanceof Error) fetchMock.mockRejectedValueOnce(answer);
    else fetchMock.mockResolvedValueOnce(answer);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

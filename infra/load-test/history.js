// NFR-14 and NFR-15 (S3-13, #127): History with filters, with the 100,000 stays of
// seed-history.sql already loaded. 20 users at the same time, each one asking for
// a mix of searches with a pause of 1 to 3 s:
//
//   k6 run history.js   (5 min, 20 users)
//
// k6 ends with an error when the p95 reaches 2 s (NFR-14) or 1% of the requests
// fail. DURACION shortens it for the local tests.
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE, headers, mySession, operatorSessions } from "./common.js";

const VUS = 20;

export const options = {
  setupTimeout: "3m",
  scenarios: {
    e2: { executor: "constant-vus", vus: VUS, duration: __ENV.DURACION || "5m" },
  },
  thresholds: {
    "http_req_duration{operacion:historial}": ["p(95)<2000"],
    // The same limit for each kind of search, so the summary shows them apart.
    "http_req_duration{filtro:dia}": ["p(95)<2000"],
    "http_req_duration{filtro:placa_parcial}": ["p(95)<2000"],
    "http_req_duration{filtro:placa_completa}": ["p(95)<2000"],
    "http_req_duration{filtro:dia_tipo}": ["p(95)<2000"],
    "http_req_failed{fase:carga}": ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  return { sessions: operatorSessions(VUS) };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function letters(count) {
  let text = "";
  for (let i = 0; i < count; i += 1) text += LETTERS[Math.floor(Math.random() * 26)];
  return text;
}

// A day of the seeded year in Bogotá (UTC-5 all year, ADR 0008): 1 to 333 days ago.
function day() {
  const daysAgo = 1 + Math.floor(Math.random() * 333);
  return new Date(Date.now() - 5 * 3600 * 1000 - daysAgo * 86400 * 1000).toISOString().slice(0, 10);
}

// The searches of US-13, in the proportions of a normal day: mostly a day or part
// of a plate (1 to 3 characters, which usually reaches the limit of 500), some
// full plates and some days with a vehicle type.
function search() {
  const r = Math.random();
  if (r < 0.4) return { filtro: "dia", query: `fecha=${day()}` };
  if (r < 0.7)
    return {
      filtro: "placa_parcial",
      query: `placa=${letters(1 + Math.floor(Math.random() * 3))}`,
    };
  if (r < 0.85) {
    const full = `${letters(3)}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    return { filtro: "placa_completa", query: `placa=${full}` };
  }
  const type = Math.random() < 0.5 ? "CARRO" : "MOTO";
  return { filtro: "dia_tipo", query: `fecha=${day()}&tipoVehiculo=${type}` };
}

export default function (data) {
  const session = mySession(data.sessions);
  const { filtro, query } = search();
  const res = http.get(`${BASE}/api/estadias?${query}`, {
    headers: headers(session),
    tags: { fase: "carga", operacion: "historial", filtro, name: `historial ${filtro}` },
  });
  check(res, { "historial 200": (r) => r.status === 200 && Array.isArray(r.json("estadias")) });
  sleep(1 + Math.random() * 2);
}

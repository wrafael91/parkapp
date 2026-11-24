// NFR-13 and NFR-15 (S3-13, #127): entries and exits of 20 operators at the same
// time. Each virtual user registers an entry, waits, registers its exit and waits
// again, with a plate of its own in every loop.
//
//   k6 run -e ESCENARIO=calentamiento entry-exit.js   (1 min, 5 users, not counted)
//   k6 run -e ESCENARIO=e1 entry-exit.js              (10 min, 20 users, pauses of 2 to 5 s)
//   k6 run -e ESCENARIO=e3 entry-exit.js              (3 min, 20 users, no pauses; informative)
//   k6 run -e ESCENARIO=rafaga entry-exit.js          (20 entries at the same instant; informative)
//
// k6 ends with an error when a threshold fails: p95 of the entry or of the exit at
// 500 ms or more (NFR-13), or 1% of failed requests or more (NFR-15). DURACION
// shortens a scenario for the local tests.
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE, headers, mySession, operatorSessions } from "./common.js";

const SCENARIOS = {
  calentamiento: { vus: 5, duration: "1m", pause: true },
  e1: { vus: 20, duration: "10m", pause: true },
  e3: { vus: 20, duration: "3m", pause: false },
  // The worst moment: the 20 operators press "Registrar" at the same instant. The
  // entries of a type wait for each other (the lock of BR-19), and the transactions
  // that wait keep their database connection, so the last one shows the queue.
  rafaga: { vus: 20, iterations: 1, pause: false },
};

const name = __ENV.ESCENARIO || "e1";
const scenario = SCENARIOS[name];
if (!scenario) {
  throw new Error(`ESCENARIO debe ser ${Object.keys(SCENARIOS).join(", ")}`);
}

export const options = {
  setupTimeout: "3m",
  scenarios: {
    [name]: scenario.iterations
      ? { executor: "per-vu-iterations", vus: scenario.vus, iterations: scenario.iterations }
      : {
          executor: "constant-vus",
          vus: scenario.vus,
          duration: __ENV.DURACION || scenario.duration,
        },
  },
  thresholds: {
    "http_req_duration{operacion:ingreso}": ["p(95)<500"],
    "http_req_duration{operacion:salida}": ["p(95)<500"],
    "http_req_failed{fase:carga}": ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  return { sessions: operatorSessions(scenario.vus) };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// A plate of this virtual user and loop, in the format of its type (RI-01): the
// letters say which user, the digits which loop. Z first, so it is easy to tell
// apart from the history; only active stays need a unique plate (RI-02).
function plate(type) {
  const user = LETTERS[(__VU - 1) % 26] + LETTERS[Math.floor((__VU - 1) / 26) % 26];
  const loop = __ITER;
  return type === "CARRO"
    ? `Z${user}${String(loop % 1000).padStart(3, "0")}`
    : `Z${user}${String(loop % 100).padStart(2, "0")}${LETTERS[Math.floor(loop / 100) % 26]}`;
}

function pause() {
  if (scenario.pause) sleep(2 + Math.random() * 3);
}

export default function (data) {
  const session = mySession(data.sessions);
  const type = Math.random() < 0.7 ? "CARRO" : "MOTO";

  const entry = http.post(
    `${BASE}/api/estadias`,
    JSON.stringify({ placa: plate(type), tipoVehiculo: type, color: "Gris", marca: "Prueba" }),
    { headers: headers(session), tags: { fase: "carga", operacion: "ingreso" } },
  );
  const entered = check(entry, { "ingreso 201": (r) => r.status === 201 });
  if (!entered) {
    pause();
    return;
  }
  pause();

  const exit = http.post(`${BASE}/api/estadias/${entry.json("id")}/salida`, null, {
    headers: headers(session),
    tags: { fase: "carga", operacion: "salida" },
  });
  check(exit, { "salida 201": (r) => r.status === 201 });
  pause();
}

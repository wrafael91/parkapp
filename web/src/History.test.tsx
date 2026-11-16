import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import History from "./History.tsx";
import { jsonResponse, stubFetch } from "./test-helpers.ts";

// Only Date is faked, so userEvent keeps its real timers. 03:30 UTC on November
// 16 is 22:30 on November 15 in Bogotá: a page that used UTC would ask for the
// 16th.
function setNow(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

// Stays as the API answers them (ADR 0008): one inside, one closed with its
// receipt and one voided that kept its receipt.
const INSIDE = {
  id: 6,
  placa: "TST12A",
  tipoVehiculo: "MOTO",
  color: "Negro",
  marca: null,
  horaIngreso: "2026-11-11T03:52:00.000Z",
  horaSalida: null,
  estado: "ACTIVA",
  comprobante: null,
};
const CLOSED = {
  id: 30,
  placa: "TST130",
  tipoVehiculo: "CARRO",
  color: "Azul",
  marca: "Kia",
  horaIngreso: "2026-11-16T00:42:22.000Z",
  horaSalida: "2026-11-16T00:47:26.000Z",
  estado: "CERRADA",
  comprobante: { consecutivo: 8, total: 1350 },
};
const VOIDED = {
  id: 31,
  placa: "TST131",
  tipoVehiculo: "CARRO",
  color: "Gris",
  marca: null,
  horaIngreso: "2026-11-15T14:00:00.000Z",
  horaSalida: null,
  estado: "ANULADA",
  comprobante: { consecutivo: 9, total: 2300 },
};
const NONE = { estadias: [], hayMas: false };
const INTERNAL_ERROR = {
  error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado." },
};

function renderHistory(onSessionEnded = vi.fn()) {
  render(<History onSessionEnded={onSessionEnded} />);
}

// The cells of each row of the table, without the header.
function rows() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    );
}

describe("history of a day", () => {
  it.each([
    [
      "after 19:00 in Bogotá, already the next day in UTC",
      "2026-11-16T03:30:00.000Z",
      "2026-11-15",
    ],
    [
      "after midnight in Bogotá, still the day before in California",
      "2026-11-16T07:30:00.000Z",
      "2026-11-16",
    ],
  ])("opens with today in Bogotá %s", async (_case, now, today) => {
    setNow(now);
    const fetchMock = stubFetch(jsonResponse(200, NONE));
    renderHistory();
    await screen.findByText("No hay estadías con esos filtros.");
    // A relative URL and no credentials (docs/modelo-amenazas.md, 7.3).
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/estadias?fecha=${today}`);
    expect(init).not.toHaveProperty("credentials");
    expect((screen.getByLabelText("Día") as HTMLInputElement).value).toBe(today);
  });

  it("shows each stay with its times in Bogotá, its state and its receipt", async () => {
    setNow("2026-11-16T03:30:00.000Z");
    stubFetch(jsonResponse(200, { estadias: [CLOSED, VOIDED, INSIDE], hayMas: false }));
    renderHistory();
    await screen.findByText("TST130");
    expect(rows()).toEqual([
      [
        "TST130",
        "Carro",
        "Azul",
        "Kia",
        "15/11/2026 19:42",
        "15/11/2026 19:47",
        "Cerrada",
        "N.º 8 · $1.350",
      ],
      ["TST131", "Carro", "Gris", "—", "15/11/2026 09:00", "—", "Anulada", "—"],
      ["TST12A", "Moto", "Negro", "—", "10/11/2026 22:52", "—", "Dentro", "—"],
    ]);
    expect(screen.queryByText(/500 estadías más recientes/)).toBeNull();
  });

  it("says when only the 500 most recent are shown", async () => {
    setNow("2026-11-16T03:30:00.000Z");
    stubFetch(jsonResponse(200, { estadias: [CLOSED], hayMas: true }));
    renderHistory();
    expect(
      await screen.findByText(
        "Se muestran las 500 estadías más recientes. Escribe una placa o elige un tipo para ver las demás.",
      ),
    ).toBeTruthy();
  });

  it.each([
    ["fails", jsonResponse(500, INTERNAL_ERROR)],
    ["cannot be reached", new TypeError("Failed to fetch")],
  ])("says so when the server %s", async (_case, answer) => {
    stubFetch(answer);
    renderHistory();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se pudo cargar el historial.");
  });

  it("goes back to sign in when the session ended", async () => {
    const onSessionEnded = vi.fn();
    stubFetch(jsonResponse(401, { error: { codigo: "NO_AUTENTICADO", mensaje: "x" } }));
    renderHistory(onSessionEnded);
    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
  });
});

describe("history filters", () => {
  it("searches with the day, the type and the plate, normalized", async () => {
    setNow("2026-11-16T03:30:00.000Z");
    const fetchMock = stubFetch(jsonResponse(200, NONE), jsonResponse(200, NONE));
    const user = userEvent.setup();
    renderHistory();
    await screen.findByText("No hay estadías con esos filtros.");
    fireEvent.change(screen.getByLabelText("Día"), { target: { value: "2026-11-10" } });
    await user.selectOptions(screen.getByLabelText("Tipo de vehículo"), "Moto");
    await user.type(screen.getByLabelText("Placa"), "tst-12");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/estadias?fecha=2026-11-10&placa=TST12&tipoVehiculo=MOTO",
    );
  });

  it("empties the day with Todos los días and searches every day by plate", async () => {
    setNow("2026-11-16T03:30:00.000Z");
    const fetchMock = stubFetch(
      jsonResponse(200, NONE),
      jsonResponse(200, { estadias: [CLOSED], hayMas: false }),
    );
    const user = userEvent.setup();
    renderHistory();
    await screen.findByText("No hay estadías con esos filtros.");
    await user.click(screen.getByRole("button", { name: "Todos los días" }));
    expect((screen.getByLabelText("Día") as HTMLInputElement).value).toBe("");
    await user.type(screen.getByLabelText("Placa"), "st 13");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("TST130");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/estadias?placa=ST13");
  });

  it("asks for a day or a plate without asking the API", async () => {
    setNow("2026-11-16T03:30:00.000Z");
    const fetchMock = stubFetch(jsonResponse(200, NONE));
    const user = userEvent.setup();
    renderHistory();
    await screen.findByText("No hay estadías con esos filtros.");
    await user.click(screen.getByRole("button", { name: "Todos los días" }));
    await user.type(screen.getByLabelText("Placa"), " - ");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Elige un día o escribe una placa.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks to check the plate when the API rejects it", async () => {
    setNow("2026-11-16T03:30:00.000Z");
    stubFetch(
      jsonResponse(200, NONE),
      jsonResponse(400, { error: { codigo: "ENTRADA_INVALIDA", mensaje: "x" } }),
    );
    const user = userEvent.setup();
    renderHistory();
    await screen.findByText("No hay estadías con esos filtros.");
    await user.type(screen.getByLabelText("Placa"), "TSB1234");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Revisa la placa: escribe de 1 a 6 letras o números.");
  });
});

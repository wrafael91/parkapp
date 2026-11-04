import { describe, expect, it } from "vitest";
import { calculateFee } from "./fee.js";

// Any entry instant works: the fee depends only on the time until the exit.
const ENTRY = new Date("2026-11-03T14:00:00.000Z");
const CAR_RATE = 230;
const MOTORCYCLE_RATE = 161;
const GRACE_MINUTES = 5;

function after(minutes: number, seconds = 0, milliseconds = 0): Date {
  return new Date(ENTRY.getTime() + (minutes * 60 + seconds) * 1000 + milliseconds);
}

function feeFor(exitTime: Date, valuePerMinute = CAR_RATE, gracePeriodMinutes = 0) {
  return calculateFee({ entryTime: ENTRY, exitTime, valuePerMinute, gracePeriodMinutes });
}

// Section 5 of docs/reglas-de-negocio.md: $230 per minute for cars, $161 for
// motorcycles and a 5-minute grace period. Each example is its own test (NFR-20).
describe("calculateFee: business rule examples", () => {
  it.each([
    { example: 1, stay: "motorcycle, 3 min", rate: MOTORCYCLE_RATE, exit: after(3), fullMinutes: 3, subtotal: 0, total: 0 },
    { example: 2, stay: "car, 5 min 59 s", rate: CAR_RATE, exit: after(5, 59), fullMinutes: 5, subtotal: 0, total: 0 },
    { example: 3, stay: "car, 6 min", rate: CAR_RATE, exit: after(6), fullMinutes: 6, subtotal: 1380, total: 1350 },
    { example: 4, stay: "car, 37 min 50 s", rate: CAR_RATE, exit: after(37, 50), fullMinutes: 37, subtotal: 8510, total: 8500 },
    { example: 5, stay: "motorcycle, 45 min", rate: MOTORCYCLE_RATE, exit: after(45), fullMinutes: 45, subtotal: 7245, total: 7200 },
    { example: 6, stay: "car, 59 min 59 s", rate: CAR_RATE, exit: after(59, 59), fullMinutes: 59, subtotal: 13570, total: 13550 },
  ])("example $example: $stay", ({ rate, exit, fullMinutes, subtotal, total }) => {
    expect(feeFor(exit, rate, GRACE_MINUTES)).toEqual({
      fullMinutes,
      subtotal,
      roundingAdjustment: subtotal - total,
      total,
    });
  });
});

describe("calculateFee: rules", () => {
  it("charges every full minute at the rate (BR-05)", () => {
    expect(feeFor(after(10))).toEqual({ fullMinutes: 10, subtotal: 2300, roundingAdjustment: 0, total: 2300 });
  });
  
  it("does not charge the seconds of an unfinished minute (BR-06)", () => {
    expect(feeFor(after(10, 59, 999))).toEqual({ fullMinutes: 10, subtotal: 2300, roundingAdjustment: 0, total: 2300 });
  });
});



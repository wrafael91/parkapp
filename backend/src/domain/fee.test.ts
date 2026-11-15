import { describe, expect, it } from "vitest";
import { calculateFee, type PeriodCap } from "./fee.js";

// Any entry instant works: the fee depends only on the time until the exit.
const ENTRY = new Date("2026-11-03T14:00:00.000Z");
const CAR_RATE = 230;
const MOTORCYCLE_RATE = 161;
const GRACE_MINUTES = 5;
// Lot B's scheme (docs/reglas-de-negocio.md, section 5, examples 7 to 13).
const LOT_B_RATE = 33;
const LOT_B_CAP = { hours: 12, value: 11_000 };

function after(minutes: number, seconds = 0, milliseconds = 0): Date {
  return new Date(ENTRY.getTime() + (minutes * 60 + seconds) * 1000 + milliseconds);
}

function feeFor(
  exitTime: Date,
  valuePerMinute = CAR_RATE,
  gracePeriodMinutes = 0,
  periodCap: PeriodCap | null = null,
) {
  return calculateFee({ entryTime: ENTRY, exitTime, valuePerMinute, gracePeriodMinutes, periodCap });
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
      capDiscount: 0,
      roundingAdjustment: subtotal - total,
      total,
    });
  });
});

// Section 5 of docs/reglas-de-negocio.md, with lot B's scheme: $33 per minute, a cap
// of $11,000 every 12 hours and a 5-minute grace period (BR-18). One test each (NFR-20).
describe("calculateFee: fee cap per period examples", () => {
  it.each([
    { example: 7, stay: "3 min", exit: after(3), fullMinutes: 3, subtotal: 0, capDiscount: 0, total: 0 },
    { example: 8, stay: "5 h 33 min", exit: after(333), fullMinutes: 333, subtotal: 10989, capDiscount: 0, total: 10950 },
    { example: 9, stay: "5 h 34 min", exit: after(334), fullMinutes: 334, subtotal: 11022, capDiscount: 22, total: 11000 },
    { example: 10, stay: "12 h 1 min", exit: after(721), fullMinutes: 721, subtotal: 23793, capDiscount: 12760, total: 11000 },
    { example: 11, stay: "12 h 3 min", exit: after(723), fullMinutes: 723, subtotal: 23859, capDiscount: 12760, total: 11050 },
    { example: 12, stay: "15 h", exit: after(900), fullMinutes: 900, subtotal: 29700, capDiscount: 12760, total: 16900 },
    { example: 13, stay: "30 h", exit: after(1800), fullMinutes: 1800, subtotal: 59400, capDiscount: 26400, total: 33000 },
  ])("example $example: $stay", ({ exit, fullMinutes, subtotal, capDiscount, total }) => {
    expect(feeFor(exit, LOT_B_RATE, GRACE_MINUTES, LOT_B_CAP)).toEqual({
      fullMinutes,
      subtotal,
      capDiscount,
      roundingAdjustment: subtotal - capDiscount - total,
      total,
    });
  });
});

describe("calculateFee: rules", () => {
  it("charges every full minute at the rate (BR-05)", () => {
    expect(feeFor(after(10))).toEqual({ fullMinutes: 10, subtotal: 2300, capDiscount: 0, roundingAdjustment: 0, total: 2300 });
  });

  it("does not charge the seconds of an unfinished minute (BR-06)", () => {
    expect(feeFor(after(10, 59, 999))).toEqual({ fullMinutes: 10, subtotal: 2300, capDiscount: 0, roundingAdjustment: 0, total: 2300 });
  });

  it("rounds the total down to the nearest multiple of $50 (BR-07)", () => {
    expect(feeFor(after(1))).toEqual({ fullMinutes: 1, subtotal: 230, capDiscount: 0, roundingAdjustment: 30, total: 200 });
  });

  it("charges nothing while the stay is shorter than the grace period (BR-08)", () => {
    expect(feeFor(after(9), CAR_RATE, 10)).toEqual({ fullMinutes: 9, subtotal: 0, capDiscount: 0, roundingAdjustment: 0, total: 0 });
  });

  it("charges nothing when the stay lasts exactly the grace period (BR-08)", () => {
    expect(feeFor(after(10), CAR_RATE, 10)).toEqual({ fullMinutes: 10, subtotal: 0, capDiscount: 0, roundingAdjustment: 0, total: 0 });
  });

  it("charges every minute since entry once the grace period is exceeded (BR-08)", () => {
    expect(feeFor(after(11), CAR_RATE, 10)).toEqual({ fullMinutes: 11, subtotal: 2530, capDiscount: 0, roundingAdjustment: 30, total: 2500 });
  });

  it("rounds the total once, not each block of the period (BR-07, BR-18)", () => {
    // 3 blocks of 1 h at $33: each one charges min($1,980, $1,030) = $1,030.
    const periodCap = { hours: 1, value: 1030 };
    expect(feeFor(after(180), LOT_B_RATE, GRACE_MINUTES, periodCap)).toEqual({ fullMinutes: 180, subtotal: 5940, capDiscount: 2850, roundingAdjustment: 40, total: 3050 });
  });

  it("never caps a stay that entered with no cap in force (BR-11, BR-18)", () => {
    expect(feeFor(after(1800), LOT_B_RATE, GRACE_MINUTES, null)).toEqual({ fullMinutes: 1800, subtotal: 59400, capDiscount: 0, roundingAdjustment: 0, total: 59400 });
  });
});

describe("calculateFee: invalid input", () => {
  it("rejects an exit before the entry (RI-05)", () => {
    expect(() => feeFor(after(0, 0, -1))).toThrow(RangeError);
  });

  it("accepts an exit at the same instant as the entry", () => {
    expect(feeFor(ENTRY)).toEqual({ fullMinutes: 0, subtotal: 0, capDiscount: 0, roundingAdjustment: 0, total: 0 });
  });

  it("rejects an invalid entry or exit time", () => {
    const invalid = new Date("not a date");
    expect(() => feeFor(invalid)).toThrow(RangeError);
    expect(() =>
      calculateFee({ entryTime: invalid, exitTime: after(10), valuePerMinute: CAR_RATE, gracePeriodMinutes: 0, periodCap: null }),
    ).toThrow(RangeError);
  });

  it.each([0, -230, 230.5, Number.NaN])("rejects a rate of %s per minute (RI-09)", (rate) => {
    expect(() => feeFor(after(10), rate)).toThrow(RangeError);
  });

  it.each([-1, 2.5, Number.NaN])("rejects a grace period of %s minutes (RI-10)", (grace) => {
    expect(() => feeFor(after(10), CAR_RATE, grace)).toThrow(RangeError);
  });

  it.each([0, 25, 2.5, Number.NaN])("rejects a cap period of %s hours (RI-20)", (hours) => {
    expect(() => feeFor(after(10), LOT_B_RATE, GRACE_MINUTES, { hours, value: 11_000 })).toThrow(RangeError);
  });

  it.each([0, -11_000, 11_000.5, Number.NaN])("rejects a cap value of %s (RI-20)", (value) => {
    expect(() => feeFor(after(10), LOT_B_RATE, GRACE_MINUTES, { hours: 12, value })).toThrow(RangeError);
  });
});

// RI-12 (docs/modelo-datos.md) is also a CHECK on `comprobante` since S3-03 (#6).
// These tests guard it in the calculation: for every stay of up to one day with
// the 2026 legal maximums for cars and motorcycles, without and with Sello Oro
// (docs/reglas-de-negocio.md, section 3), and for every stay of up to two days
// with a cap of the shortest and the longest period and lot B's (BR-18).
describe("calculateFee: receipt integrity (RI-12)", () => {
  it("keeps total = subtotal - adjustment, an adjustment of $0 to $49 and a multiple of $50 for every minute of a day", () => {
    for (const rate of [CAR_RATE, MOTORCYCLE_RATE, 253, 177]) {
      for (let minutes = 0; minutes <= 24 * 60; minutes++) {
        const { subtotal, roundingAdjustment, total } = feeFor(after(minutes), rate, GRACE_MINUTES);
        const stay = `rate ${rate}, ${minutes} min`;
        expect(total, stay).toBe(subtotal - roundingAdjustment);
        expect(roundingAdjustment, stay).toBeGreaterThanOrEqual(0);
        expect(roundingAdjustment, stay).toBeLessThanOrEqual(49);
        expect(total % 50, stay).toBe(0);
      }
    }
  });

  it("keeps total = subtotal - cap discount - adjustment, a discount of $0 to the subtotal and a multiple of $50 with a cap, for every minute of two days", () => {
    const caps = [{ hours: 1, value: 1030 }, LOT_B_CAP, { hours: 24, value: 50_000 }];
    for (const rate of [LOT_B_RATE, CAR_RATE, MOTORCYCLE_RATE]) {
      for (const periodCap of caps) {
        for (let minutes = 0; minutes <= 2 * 24 * 60; minutes++) {
          const fee = feeFor(after(minutes), rate, GRACE_MINUTES, periodCap);
          const { subtotal, capDiscount, roundingAdjustment, total } = fee;
          const stay = `rate ${rate}, cap ${periodCap.value} every ${periodCap.hours} h, ${minutes} min`;
          expect(total, stay).toBe(subtotal - capDiscount - roundingAdjustment);
          expect(capDiscount, stay).toBeGreaterThanOrEqual(0);
          expect(capDiscount, stay).toBeLessThanOrEqual(subtotal);
          expect(roundingAdjustment, stay).toBeGreaterThanOrEqual(0);
          expect(roundingAdjustment, stay).toBeLessThanOrEqual(49);
          expect(total % 50, stay).toBe(0);
        }
      }
    }
  });
});

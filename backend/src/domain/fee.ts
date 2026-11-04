const MS_PER_MINUTE = 60_000;
// BR-07: the total is rounded down to a multiple of this many pesos.
const ROUNDING_STEP = 50;

export interface FeeInput {
  entryTime: Date;
  exitTime: Date;
  valuePerMinute: number;
  gracePeriodMinutes: number;
}

// Same fields as `comprobante` (docs/modelo-datos.md).
export interface Fee {
  fullMinutes: number;
  subtotal: number;
  roundingAdjustment: number;
  total: number;
}

// Fee for a stay (docs/reglas-de-negocio.md, BR-05 to BR-08). Pure function: it
// does not use Prisma or read the clock (docs/arquitectura.md, 5.1).
// BR-11: the caller passes the rate and the grace period stored with the stay,
// the ones in force at entry; this function never looks up the current ones.
export function calculateFee(input: FeeInput): Fee {
  assertValid(input);
  const { entryTime, exitTime, valuePerMinute, gracePeriodMinutes } = input;

  // BR-06: only full minutes count; the seconds of an unfinished minute are free.
  const fullMinutes = Math.floor((exitTime.getTime() - entryTime.getTime()) / MS_PER_MINUTE);

  // BR-08: the grace period is a threshold, not a discount, compared with full
  // minutes. Up to the grace period the fee is $0; past it, every minute is charged.
  if (fullMinutes <= gracePeriodMinutes) {
    return { fullMinutes, subtotal: 0, roundingAdjustment: 0, total: 0 };
  }

  // BR-05: every full minute at the rate, with no minimum stay.
  const subtotal = fullMinutes * valuePerMinute;
  // BR-07: round down to a multiple of $50, so the adjustment is $0 to $49 (RI-12).
  const roundingAdjustment = subtotal % ROUNDING_STEP;
  return { fullMinutes, subtotal, roundingAdjustment, total: subtotal - roundingAdjustment };
}

// RI-05, RI-09 and RI-10 become database CHECK constraints in S1-05 (Sprint 3).
// Until then this is the only guard: without it, an exit before the entry gave
// -1 minutes, an invalid date gave NaN and a rate of 0 charged $0, with no error.
function assertValid({ entryTime, exitTime, valuePerMinute, gracePeriodMinutes }: FeeInput): void {
  const entry = entryTime.getTime();
  const exit = exitTime.getTime();
  if (Number.isNaN(entry) || Number.isNaN(exit)) {
    throw new RangeError("Entry and exit times must be valid dates");
  }
  if (exit < entry) {
    throw new RangeError("Exit time must not be before entry time");
  }
  if (!Number.isInteger(valuePerMinute) || valuePerMinute <= 0) {
    throw new RangeError("Rate per minute must be a positive integer");
  }
  if (!Number.isInteger(gracePeriodMinutes) || gracePeriodMinutes < 0) {
    throw new RangeError("Grace period must be a non-negative integer number of minutes");
  }
}

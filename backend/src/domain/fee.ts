const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
// BR-07: the total is rounded down to a multiple of this many pesos.
const ROUNDING_STEP = 50;

// BR-18: a maximum value for each period of the given number of hours.
export interface PeriodCap {
  hours: number;
  value: number;
}

export interface FeeInput {
  entryTime: Date;
  exitTime: Date;
  valuePerMinute: number;
  gracePeriodMinutes: number;
  // null when no cap was in force at entry (BR-11).
  periodCap: PeriodCap | null;
}

// Same fields as `comprobante` (docs/modelo-datos.md).
export interface Fee {
  fullMinutes: number;
  subtotal: number;
  capDiscount: number;
  roundingAdjustment: number;
  total: number;
}

// Fee for a stay (docs/reglas-de-negocio.md, BR-05 to BR-08 and BR-18). Pure
// function: it does not use Prisma or read the clock (docs/arquitectura.md, 5.1).
// BR-11: the caller passes the rate, the grace period and the cap stored with the
// stay, the ones in force at entry; this function never looks up the current ones.
export function calculateFee(input: FeeInput): Fee {
  assertValid(input);
  const { entryTime, exitTime, valuePerMinute, gracePeriodMinutes, periodCap } = input;

  // BR-06: only full minutes count; the seconds of an unfinished minute are free.
  const fullMinutes = Math.floor((exitTime.getTime() - entryTime.getTime()) / MS_PER_MINUTE);

  // BR-08: the grace period is a threshold, not a discount, compared with full
  // minutes. Up to the grace period the fee is $0; past it, every minute is charged.
  if (fullMinutes <= gracePeriodMinutes) {
    return { fullMinutes, subtotal: 0, capDiscount: 0, roundingAdjustment: 0, total: 0 };
  }

  // BR-05: every full minute at the rate, with no minimum stay.
  const subtotal = fullMinutes * valuePerMinute;
  // BR-18: the cap lowers what is charged; the subtotal stays minutes x rate.
  const charged =
    periodCap === null ? subtotal : chargeByPeriod(fullMinutes, valuePerMinute, periodCap);
  const capDiscount = subtotal - charged;
  // BR-07: round down to a multiple of $50, so the adjustment is $0 to $49 (RI-12).
  const roundingAdjustment = charged % ROUNDING_STEP;
  return {
    fullMinutes,
    subtotal,
    capDiscount,
    roundingAdjustment,
    total: charged - roundingAdjustment,
  };
}

// BR-18: the stay is split into blocks of the period counted from entry, not by
// the clock, so each vehicle has its own blocks. Each block, full or partial,
// charges its full minutes at the rate up to the cap. Grace (BR-08) and rounding
// (BR-07) are not applied per block: the caller does it once, for the stay.
function chargeByPeriod(fullMinutes: number, valuePerMinute: number, cap: PeriodCap): number {
  const periodMinutes = cap.hours * MINUTES_PER_HOUR;
  const fullBlocks = Math.floor(fullMinutes / periodMinutes);
  const lastBlockMinutes = fullMinutes % periodMinutes;
  const blockCharge = (minutes: number) => Math.min(minutes * valuePerMinute, cap.value);
  return fullBlocks * blockCharge(periodMinutes) + blockCharge(lastBlockMinutes);
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

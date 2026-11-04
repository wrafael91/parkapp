export interface FeeInput {
  entryTime: Date;
  exitTime: Date;
  valuePerMinute: number;
  gracePeriodMinutes: number;
}

export interface Fee {
  fullMinutes: number;
  subtotal: number;
  roundingAdjustment: number;
  total: number;
}

export function calculateFee(input: FeeInput): Fee {
  assertValid(input);
  const fullMinutes = Math.floor((input.exitTime.getTime() - input.entryTime.getTime()) / 60_000);
  if (fullMinutes <= input.gracePeriodMinutes) {
    return { fullMinutes, subtotal: 0, roundingAdjustment: 0, total: 0 };
  }
  const subtotal = fullMinutes * input.valuePerMinute;
  const roundingAdjustment = subtotal % 50;
  return { fullMinutes, subtotal, roundingAdjustment, total: subtotal - roundingAdjustment };
}

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

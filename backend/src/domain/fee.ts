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
  const fullMinutes = Math.floor((input.exitTime.getTime() - input.entryTime.getTime()) / 60_000);
  if (fullMinutes <= input.gracePeriodMinutes) {
    return { fullMinutes, subtotal: 0, roundingAdjustment: 0, total: 0 };
  }
  const subtotal = fullMinutes * input.valuePerMinute;
  const roundingAdjustment = subtotal % 50;
  return { fullMinutes, subtotal, roundingAdjustment, total: subtotal - roundingAdjustment };
}

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
  const fullMinutes = (input.exitTime.getTime() - input.entryTime.getTime()) / 60_000;
  const subtotal = fullMinutes * input.valuePerMinute;
  return { fullMinutes, subtotal, roundingAdjustment: 0, total: subtotal };
}

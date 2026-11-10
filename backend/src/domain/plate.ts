// Same values as VehicleType in Prisma; the domain does not import Prisma.
export type PlateVehicleType = "CAR" | "MOTORCYCLE";

// RI-01: Colombian plates. Three letters and three digits for a car; three
// letters, two digits and a letter for a motorcycle.
const PLATE_FORMATS: Record<PlateVehicleType, RegExp> = {
  CAR: /^[A-Z]{3}[0-9]{3}$/,
  MOTORCYCLE: /^[A-Z]{3}[0-9]{2}[A-Z]$/,
};

// FR-08: the plate in uppercase, without spaces or hyphens, or null if it does
// not have the format of its vehicle type.
export function normalizePlate(input: string, vehicleType: PlateVehicleType): string | null {
  const plate = input.toUpperCase().replace(/[\s-]/g, "");
  return PLATE_FORMATS[vehicleType].test(plate) ? plate : null;
}

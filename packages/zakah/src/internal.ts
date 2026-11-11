import DecimalJs from "decimal.js";
import type { NairaAmount } from "./types";

// A private Decimal constructor, so this package never changes the
// global decimal.js configuration another library (e.g. Prisma) relies on.
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;

export class ZakahInputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = "ZakahInputError";
  }
}

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

export function parseAmount(field: string, raw: unknown): Decimal {
  if (typeof raw !== "string" || !PLAIN_DECIMAL.test(raw)) {
    throw new ZakahInputError(field, `must be a non-negative decimal string like "1500" or "1500.50", got ${JSON.stringify(raw)}`);
  }
  return new Decimal(raw);
}

export function parsePositive(field: string, raw: unknown): Decimal {
  const value = parseAmount(field, raw);
  if (value.lessThanOrEqualTo(0)) throw new ZakahInputError(field, "must be greater than zero");
  return value;
}

/** Rounds to the kobo, half-up — used for every displayed value. */
export function toKobo(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function format(value: Decimal): NairaAmount {
  return value.toFixed(2);
}

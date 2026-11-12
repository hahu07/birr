import { ZakahInputError } from "./internal";

/** Payers see a warning once prices are older than this (owner's decision, 2026-11-11). */
export const PRICES_STALE_AFTER_DAYS = 7;
/** No figure is given at all once prices are older than this. */
export const PRICES_EXPIRED_AFTER_DAYS = 31;

export type PriceFreshnessStatus = "fresh" | "stale" | "expired";

export interface PriceFreshness {
  ageDays: number;
  status: PriceFreshnessStatus;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(field: string, isoDate: string): number {
  const ms = ISO_DATE.test(isoDate) ? Date.parse(`${isoDate}T00:00:00Z`) : NaN;
  if (Number.isNaN(ms)) throw new ZakahInputError(field, `must be a date like "2027-02-08", got ${JSON.stringify(isoDate)}`);
  return Math.round(ms / 86_400_000);
}

/**
 * How old a price is on `today`, in whole calendar days. Both are ISO
 * dates (no clock inside this package — the caller says what today is).
 * A price dated after `today` counts as fresh; the backend refuses to
 * record one in the first place.
 */
export function priceFreshness(asOf: string, today: string): PriceFreshness {
  const ageDays = Math.max(0, dayNumber("today", today) - dayNumber("prices.asOf", asOf));
  const status =
    ageDays > PRICES_EXPIRED_AFTER_DAYS ? "expired" : ageDays > PRICES_STALE_AFTER_DAYS ? "stale" : "fresh";
  return { ageDays, status };
}

/**
 * Monthly giving runs on Lagos time (UTC+1 all year, no daylight saving):
 * a gift is charged on its day of the month at 09:00 in Lagos. A "period"
 * names the month a charge collects, e.g. "2026-12".
 */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
/** 09:00 in Lagos. */
const CHARGE_HOUR_UTC = 8;

function lagosParts(date: Date) {
  const lagos = new Date(date.getTime() + LAGOS_OFFSET_MS);
  return { year: lagos.getUTCFullYear(), month: lagos.getUTCMonth() + 1, day: lagos.getUTCDate() };
}

function format(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parse(period: string): { year: number; month: number } {
  const [year, month] = period.split("-").map(Number);
  return { year, month };
}

/** The month (in Lagos) that a date falls in. */
export function periodOf(date: Date): string {
  const { year, month } = lagosParts(date);
  return format(year, month);
}

export function addMonths(period: string, months: number): string {
  const { year, month } = parse(period);
  const index = year * 12 + (month - 1) + months;
  return format(Math.floor(index / 12), (index % 12) + 1);
}

/** The day a new monthly gift repeats on: today in Lagos, or the 28th, so every month has it. */
export function dayOfMonthFor(date: Date): number {
  return Math.min(lagosParts(date).day, 28);
}

/** When a period's charge is due: its day of the month, 09:00 Lagos. */
export function chargeDateFor(period: string, dayOfMonth: number): Date {
  const { year, month } = parse(period);
  return new Date(Date.UTC(year, month - 1, dayOfMonth, CHARGE_HOUR_UTC));
}

/** Whether a card expiring at the end of expMonth/expYear has expired by `date`. */
export function cardExpiredBy(expMonth: number | null, expYear: number | null, date: Date): boolean {
  if (!expMonth || !expYear) return false;
  // A card is valid through the last day of its expiry month.
  return date.getTime() >= Date.UTC(expYear, expMonth, 1);
}

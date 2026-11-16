/**
 * Limits and formats for what people type into Birr's forms (2026-11-16),
 * shared so the API's checks and the web forms' hints are the same numbers.
 */
export const FIELD_LIMITS = {
  /** A person's or organisation's name. */
  name: 200,
  /** A short line of text: a title, an address line, an authority. */
  text: 300,
  /** A code, key or reference number. */
  code: 100,
  /** An id. */
  id: 100,
  /** Notes, reasons, descriptions. */
  longText: 5000,
  /** An article's body. */
  article: 100_000,
  email: 254,
  url: 2048,
  /** A currency code (ISO 4217, or a test code). */
  currency: 16,
  /** A password, token or hash: never trimmed or changed. */
  secret: 1000,
} as const;

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * A phone number in E.164: "0803 123 4567", "2348031234567" and
 * "+234 803 123 4567" all become "+2348031234567". A leading 0 is read as
 * a Nigerian number. Null when it can't be a phone number.
 */
export function normalizePhoneNumber(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "");
  let e164: string;
  if (digits.startsWith("+")) e164 = digits;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (digits.startsWith("0")) e164 = `+234${digits.slice(1)}`;
  else if (digits.startsWith("234")) e164 = `+${digits}`;
  else return null;
  return E164.test(e164) ? e164 : null;
}

export const isE164 = (value: string) => E164.test(value);

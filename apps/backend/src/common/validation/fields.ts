import { applyDecorators } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsEmail, IsISO8601, IsObject, IsString, IsUrl, Matches, MaxLength, ValidateBy } from "class-validator";
import { FIELD_LIMITS, normalizePhoneNumber } from "@birr/shared";

/**
 * The rules for what people type into Birr's forms (owner's decision,
 * 2026-11-16, after the counterparty form accepted anything). Every text
 * field in an API input uses one of these, or another rule that bounds it
 * (an enum, a decimal, a country code); dto-coverage.spec.ts fails on any
 * that doesn't. Limits are shared with the web forms via @birr/shared.
 *
 * Text is trimmed, and blank text counts as not given: a required field
 * then fails as "X is required" (main.ts's exceptionFactory words every
 * message), an optional one is simply left out. Ids, passwords, tokens and
 * hashes are never changed.
 */
const blankToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};
const trimmed = () => Transform(({ value }) => blankToUndefined(value));
const each = (options: { each?: boolean }) => (options.each ? { each: true } : {});
const tooLong = (max: number) => `$property must be at most ${max.toLocaleString("en")} characters.`;

/**
 * Trimming alone, for a field that keeps its own length and minimum rules
 * (a reason that must be a sentence, a name of at least two letters): so
 * "   " counts as not given there too.
 */
export function Trimmed() {
  return trimmed();
}

/** A short line of text: up to 300 characters unless told otherwise. */
export function TextField(max: number = FIELD_LIMITS.text) {
  return applyDecorators(trimmed(), IsString(), MaxLength(max, { message: tooLong(max) }));
}

/** Notes, reasons, descriptions: up to 5,000 characters unless told otherwise. */
export function LongTextField(max: number = FIELD_LIMITS.longText) {
  return TextField(max);
}

/** A person's or organisation's name: up to 200 characters, with at least one letter. */
export function NameField() {
  return applyDecorators(
    trimmed(),
    IsString(),
    MaxLength(FIELD_LIMITS.name, { message: tooLong(FIELD_LIMITS.name) }),
    Matches(/\p{L}/u, { message: "$property must contain letters." }),
  );
}

/**
 * An email address, trimmed. Not lower-cased here: accounts are found by
 * the email as stored, and the services that compare emails do their own
 * case-folding.
 */
export function EmailField() {
  return applyDecorators(
    trimmed(),
    IsEmail({}, { message: "$property must be a valid email address, like name@example.com." }),
    MaxLength(FIELD_LIMITS.email, { message: tooLong(FIELD_LIMITS.email) }),
  );
}

/** A phone number, stored in E.164 (a Nigerian "0803 123 4567" becomes "+2348031234567"). */
export function PhoneField() {
  return applyDecorators(
    Transform(({ value }) => {
      const v = blankToUndefined(value);
      return typeof v === "string" ? (normalizePhoneNumber(v) ?? v) : v;
    }),
    IsString(),
    Matches(/^\+[1-9]\d{7,14}$/, { message: "$property must be a phone number, like 0803 123 4567 or +234 803 123 4567." }),
  );
}

/** A web address: http(s), with a real host. */
export function UrlField() {
  return applyDecorators(
    trimmed(),
    IsUrl({ protocols: ["http", "https"], require_protocol: true, require_tld: true }, { message: "$property must be a web address starting with https://." }),
    MaxLength(FIELD_LIMITS.url, { message: tooLong(FIELD_LIMITS.url) }),
  );
}

/** A date, or a date and time, in ISO 8601 (as the app's date inputs send it). */
export function DateField() {
  return applyDecorators(trimmed(), IsISO8601({ strict: true }, { message: "$property must be a date." }));
}

/** An id, key or code: up to 100 characters, never changed. */
export function IdField(options: { each?: boolean; max?: number } = {}) {
  const max = options.max ?? FIELD_LIMITS.id;
  return applyDecorators(IsString(each(options)), MaxLength(max, { ...each(options), message: tooLong(max) }));
}

/** A password, token or hash: bounded, never trimmed or changed. */
export function SecretField(max: number = FIELD_LIMITS.secret) {
  return applyDecorators(IsString(), MaxLength(max, { message: tooLong(max) }));
}

/** A free-form object (e.g. analytics metadata): an object, at most `max` characters as JSON. */
export function JsonObjectField(max: number) {
  return applyDecorators(
    IsObject({ message: "$property must be an object." }),
    ValidateBy({
      name: "maxJsonSize",
      validator: {
        validate: (value: unknown) => {
          try {
            return JSON.stringify(value).length <= max;
          } catch {
            return false;
          }
        },
        defaultMessage: () => `$property is too large (at most ${max.toLocaleString("en")} characters).`,
      },
    }),
  );
}

/** Names of every rule above, for dto-coverage.spec.ts. */
export const FIELD_RULES = ["Trimmed", "TextField", "LongTextField", "NameField", "EmailField", "PhoneField", "UrlField", "DateField", "IdField", "SecretField", "JsonObjectField"];

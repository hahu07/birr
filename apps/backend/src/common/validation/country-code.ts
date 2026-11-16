import { BadRequestException, PipeTransform, applyDecorators } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString } from "class-validator";
import { COUNTRIES, isCountryCode } from "@birr/shared";

const CODES = COUNTRIES.map((c) => c.code);
const normalise = (value: unknown) => {
  if (typeof value !== "string") return value;
  const code = value.trim().toUpperCase();
  return code === "" ? undefined : code;
};

/**
 * A jurisdiction: a two-letter ISO 3166-1 country code (owner's decision,
 * 2026-11-16), so a Waqf Fund, its compliance policy and Birr's trustee
 * licence for that country always match. Trimmed and upper-cased; a
 * country name ("Nigeria") is refused — the app offers a country list.
 */
export function CountryCode(options: { optional?: boolean } = {}) {
  return applyDecorators(
    Transform(({ value }) => normalise(value)),
    ...(options.optional ? [IsOptional()] : []),
    IsString({ message: "$property must be a country, chosen from the list." }),
    IsIn(CODES, { message: "$property must be a country, chosen from the list (a two-letter code such as NG)." }),
  );
}

/** The same rule for a jurisdiction in a URL path. */
export class ParseCountryCodePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const code = normalise(value);
    if (!isCountryCode(code)) throw new BadRequestException("Jurisdiction must be a country, as a two-letter code such as NG.");
    return code;
  }
}

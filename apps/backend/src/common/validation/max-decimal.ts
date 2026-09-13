import { registerDecorator, ValidationOptions } from "class-validator";

/**
 * Shared ceiling for the platform's public, unauthenticated contribution
 * endpoints (Vault giving, Founder contributions) — see MaxDecimal's own
 * comment on why this is a blunt safety limit, not a business rule.
 * Generous enough that no legitimate single contribution in any
 * supported currency should ever hit it.
 */
export const MAX_PUBLIC_CONTRIBUTION_AMOUNT = 100_000_000;

/**
 * A sanity ceiling on a numeric-string amount field (see AssetsService's
 * CreateAssetInput.estimatedValue for why these fields are
 * @IsNumberString rather than @IsNumber — @Max() itself only works on
 * a real number, so it can't be chained onto them directly). This is
 * deliberately a blunt, currency-agnostic safety limit against a
 * malformed or malicious value reaching Prisma.Decimal and a payment
 * adapter's minor-units math unchecked — not a business policy on
 * "how large a legitimate contribution can be" (that would need a
 * proper per-currency, ops-editable table, the same shape as
 * ContributionMinimum, if it's ever actually needed).
 */
export function MaxDecimal(max: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "maxDecimal",
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must not exceed ${max}.`, ...validationOptions },
      validator: {
        // Closes over `max` directly rather than reading it back from
        // `args.constraints` — simpler, and sidesteps that argument's
        // possibly-undefined typing for no real benefit here.
        validate(value: unknown) {
          if (typeof value !== "string" && typeof value !== "number") return false;
          const num = Number(value);
          return Number.isFinite(num) && num <= max;
        },
      },
    });
  };
}

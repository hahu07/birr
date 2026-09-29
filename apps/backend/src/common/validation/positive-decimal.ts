import { registerDecorator, ValidationOptions } from "class-validator";

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Rejects zero, negatives, signs and exponent notation on a money amount.
 * @IsNumberString alone accepts "-5000000" — and a negative pending
 * distribution counts toward a cause's committed total, silently raising
 * the headroom every later distribution is checked against.
 */
export function IsPositiveDecimal(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isPositiveDecimal",
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a positive amount.`, ...validationOptions },
      validator: {
        validate(value: unknown) {
          if (typeof value === "number") return Number.isFinite(value) && value > 0;
          if (typeof value !== "string" || !PLAIN_DECIMAL.test(value)) return false;
          return Number(value) > 0;
        },
      },
    });
  };
}

import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { validationMessages } from "./messages";

/**
 * The one ValidationPipe every request goes through (main.ts): unknown
 * fields refused, input transformed (trimmed, normalised by the field
 * rules in fields.ts), and errors worded plainly (messages.ts).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new BadRequestException(validationMessages(errors)),
  });
}

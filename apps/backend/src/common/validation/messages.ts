import type { ValidationError } from "class-validator";

/** "contactEmail" -> "Contact email", "founderIds" -> "Founder ids". */
export function fieldLabel(property: string): string {
  const words = property
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/**
 * The API's validation errors in plain words (2026-11-16): one line per
 * problem, naming the field the way a form labels it. A missing required
 * field says "X is required."; an item in a list says which one. Used by
 * the global ValidationPipe (main.ts), so every form shows the same kind
 * of message.
 */
export function validationMessages(errors: ValidationError[], where = ""): string[] {
  const out: string[] = [];
  for (const error of errors) {
    const isIndex = /^\d+$/.test(error.property);
    if (isIndex) {
      out.push(...validationMessages(error.children ?? [], `${where}${where ? ", " : ""}item ${Number(error.property) + 1}`));
      continue;
    }
    const label = fieldLabel(error.property);
    const suffix = where ? ` (${where})` : "";
    const constraints = error.constraints ?? {};
    if ("whitelistValidation" in constraints) {
      out.push(`${label} isn't accepted here${suffix}.`);
    } else if (Object.keys(constraints).length && (error.value === undefined || error.value === null)) {
      out.push(`${label} is required${suffix}.`);
    } else {
      for (const message of Object.values(constraints)) {
        const reworded = message.startsWith(error.property) ? label + message.slice(error.property.length) : message;
        out.push(sentence(reworded) .replace(/\.$/, `${suffix}.`));
      }
    }
    if (error.children?.length) out.push(...validationMessages(error.children, where ? `${where}, ${label.toLowerCase()}` : label.toLowerCase()));
  }
  return [...new Set(out)];
}

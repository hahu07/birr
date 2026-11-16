import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { FIELD_RULES } from "./fields";

/**
 * Every text field an API input accepts is bounded and checked (owner's
 * decision, 2026-11-16, after the counterparty form accepted anything):
 * one of the field rules in fields.ts, a country code, an enum or a fixed
 * list, a decimal, a date, an id, or an explicit length limit. This scans
 * the source for decorated input properties typed as text and fails on any
 * left unbounded — so a new form can't quietly take whatever it's sent.
 * Same idea as route-role-coverage.spec.ts.
 */
const ROOT = join(__dirname, "..", "..");
const BOUNDED = new Set([
  ...FIELD_RULES,
  "CountryCode",
  "MaxLength",
  "Length",
  "IsEnum",
  "IsIn",
  "IsUUID",
  "IsNumberString",
  "IsPositiveDecimal",
  "IsISO8601",
  "IsDateString",
  "IsBooleanString",
  "Matches",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "test-support" ? [] : sourceFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".spec.ts") ? [path] : [];
  });
}

interface Field {
  where: string;
  property: string;
  decorators: string[];
}

function textFields(): Field[] {
  const fields: Field[] = [];
  for (const file of sourceFiles(ROOT)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let cls = "";
    let decorators: string[] = [];
    lines.forEach((line, i) => {
      const classMatch = line.match(/^(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        cls = classMatch[1];
        decorators = [];
        return;
      }
      const decorator = line.match(/^\s*@([A-Za-z]+)\(/);
      if (decorator) {
        decorators.push(decorator[1]);
        // Several decorators on one line ("@IsOptional() @TextField()").
        for (const more of line.matchAll(/\)\s*@([A-Za-z]+)\(/g)) decorators.push(more[1]);
        return;
      }
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      const property = line.match(/^\s*(?:readonly\s+)?(\w+)[!?]?\s*:\s*([^;=]+);/);
      if (property && cls && decorators.length && /\bstring\b/.test(property[2])) {
        fields.push({ where: `${relative(ROOT, file)}:${i + 1} ${cls}`, property: property[1], decorators: [...decorators] });
      }
      if (trimmed) decorators = [];
    });
  }
  return fields;
}

describe("every text field an API input accepts is bounded and checked", () => {
  const fields = textFields();

  test("the scan finds the input classes", () => {
    expect(fields.length).toBeGreaterThan(250);
  });

  test("no text field is left unbounded", () => {
    const unbounded = fields.filter((f) => !f.decorators.some((d) => BOUNDED.has(d))).map((f) => `${f.where}.${f.property} [${f.decorators.join(", ")}]`);
    expect(unbounded).toEqual([]);
  });

  // Free text (a bare @IsString with its own limits) is trimmed too, so
  // "   " never passes as a name or a reason. A rule from fields.ts trims
  // on its own; ids, passwords and tokens are deliberately left exactly as
  // sent, and so are the properties below.
  const UNTRIMMED: Record<string, string> = {
    whatsappProof: "a signed proof of a confirmed WhatsApp number, checked exactly as issued",
  };
  test("free text is trimmed", () => {
    const untrimmed = fields
      .filter((f) => f.decorators.includes("IsString") && !f.decorators.some((d) => FIELD_RULES.includes(d)) && !UNTRIMMED[f.property])
      .map((f) => `${f.where}.${f.property} [${f.decorators.join(", ")}]`);
    expect(untrimmed).toEqual([]);
  });
});

import { validate } from "class-validator";
import { IsNumberString } from "class-validator";
import { MaxDecimal } from "./max-decimal";

class Fixture {
  @IsNumberString()
  @MaxDecimal(1000)
  amount!: string;
}

async function validateAmount(amount: string) {
  const fixture = new Fixture();
  fixture.amount = amount;
  return validate(fixture);
}

describe("MaxDecimal", () => {
  test("passes for a value at the ceiling", async () => {
    expect(await validateAmount("1000")).toHaveLength(0);
  });

  test("passes for a value well under the ceiling", async () => {
    expect(await validateAmount("100")).toHaveLength(0);
  });

  test("rejects a value over the ceiling", async () => {
    const errors = await validateAmount("1000.01");
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty("maxDecimal");
  });

  test("rejects an absurdly large value", async () => {
    const errors = await validateAmount("99999999999999999999");
    expect(errors.some((e) => e.constraints && "maxDecimal" in e.constraints)).toBe(true);
  });

  test("rejects a non-numeric string (caught by @IsNumberString, not this validator)", async () => {
    const errors = await validateAmount("not-a-number");
    expect(errors.length).toBeGreaterThan(0);
  });
});

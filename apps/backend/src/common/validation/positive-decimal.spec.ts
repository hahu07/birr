import { IsNumberString, validate } from "class-validator";
import { IsPositiveDecimal } from "./positive-decimal";

class Fixture {
  @IsNumberString()
  @IsPositiveDecimal()
  amount!: string;
}

async function errorsFor(amount: string) {
  const fixture = new Fixture();
  fixture.amount = amount;
  return (await validate(fixture)).flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe("IsPositiveDecimal", () => {
  test.each(["1", "0.01", "5000000", "100.50"])("accepts %s", async (amount) => {
    expect(await errorsFor(amount)).toEqual([]);
  });

  // "-5000000" passes @IsNumberString on its own — the gap this closes.
  test.each(["-5000000", "-0.01", "0", "0.00", "+5", "1e3", " 5"])("rejects %s", async (amount) => {
    expect(await errorsFor(amount)).toContain("isPositiveDecimal");
  });
});

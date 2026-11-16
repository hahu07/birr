import { providerFieldValueError, validateFromAddress } from "./provider-fields";

describe("validateFromAddress", () => {
  test.each(["onboarding@resend.dev", "BirrWaqf <onboarding@resend.dev>", '"Birr Waqf" <hello@birr.org>'])(
    "accepts %s",
    (value) => {
      expect(validateFromAddress(value)).toBeNull();
    },
  );

  test.each([
    "BirrWaqf <onboarding@resend.dev", // the 2026-09-29 typo: no closing ">"
    "BirrWaqf onboarding@resend.dev",
    "<onboarding@resend.dev>",
    "BirrWaqf  <onboarding@resend.dev>",
    "Birr <hello@birr>",
    "not-an-email",
    "",
  ])("rejects %p", (value) => {
    expect(validateFromAddress(value)).not.toBeNull();
  });
});

describe("providerFieldValueError", () => {
  test("prefixes the field's label", () => {
    expect(providerFieldValueError("resend", "FROM_ADDRESS", "BirrWaqf <onboarding@resend.dev")).toMatch(/^From address: /);
  });

  test("returns null for a field with no validation", () => {
    expect(providerFieldValueError("resend", "API_KEY", "anything")).toBeNull();
  });
});

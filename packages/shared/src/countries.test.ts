import { describe, expect, test } from "vitest";
import { COUNTRIES, countryLabel, countryName, isCountryCode } from "./index";

describe("countries", () => {
  test("every ISO 3166-1 alpha-2 code, once, as two capital letters", () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(249);
    for (const c of COUNTRIES) expect(c.code).toMatch(/^[A-Z]{2}$/);
  });

  test("codes, names and labels", () => {
    expect(isCountryCode("NG")).toBe(true);
    expect(isCountryCode("ng")).toBe(false);
    expect(isCountryCode("Nigeria")).toBe(false);
    expect(isCountryCode("XX")).toBe(false);
    expect(countryName("AE")).toBe("United Arab Emirates");
    expect(countryName("ng")).toBe("Nigeria");
    expect(countryName(null)).toBe("");
    expect(countryLabel("NG")).toBe("Nigeria (NG)");
  });
});

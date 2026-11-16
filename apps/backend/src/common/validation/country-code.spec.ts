import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { BadRequestException } from "@nestjs/common";
import { RegisterCounterpartyInput } from "../../modules/counterparties/counterparties.service";
import { CreateWaqfInput } from "../../modules/waqfs/waqfs.service";
import { ParseCountryCodePipe } from "./country-code";

// Jurisdiction is a two-letter ISO country code everywhere (2026-11-16).
describe("CountryCode", () => {
  const counterparty = (jurisdiction: unknown) =>
    plainToInstance(RegisterCounterpartyInput, {
      name: "Lotus Capital",
      institutionType: "asset_manager",
      jurisdiction,
      businessActivities: "Asset and fund management for Shariah-compliant mandates.",
    });
  const jurisdictionErrors = async (input: object) => (await validate(input)).filter((e) => e.property === "jurisdiction");

  test("accepts a country code, trimmed and upper-cased", async () => {
    const input = counterparty(" ng ");
    expect(await jurisdictionErrors(input)).toEqual([]);
    expect(input.jurisdiction).toBe("NG");
  });

  test.each([["Nigeria"], ["XX"], ["NGA"], [""], [42]])("refuses %p with a plain reason", async (value) => {
    const errors = await jurisdictionErrors(counterparty(value));
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {}).join(" ")).toMatch(/must be a country/);
  });

  test("Waqf Funds use the same rule", async () => {
    const input = plainToInstance(CreateWaqfInput, { jurisdiction: "Nigeria" });
    expect(await jurisdictionErrors(input)).toHaveLength(1);
  });

  test("a jurisdiction in a URL path is checked too", () => {
    const pipe = new ParseCountryCodePipe();
    expect(pipe.transform("ae")).toBe("AE");
    expect(() => pipe.transform("Nigeria")).toThrow(BadRequestException);
  });
});

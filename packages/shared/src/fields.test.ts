import { describe, expect, test } from "vitest";
import { fieldProblem, normalizePhoneNumber, phoneCharactersOnly } from "./index";

describe("normalizePhoneNumber", () => {
  test("reads Nigerian and international forms as E.164", () => {
    for (const raw of ["0803 123 4567", "08031234567", "2348031234567", "+234 803 123 4567", "00234-803-123-4567"]) {
      expect(normalizePhoneNumber(raw)).toBe("+2348031234567");
    }
    expect(normalizePhoneNumber("+44 7700 900123")).toBe("+447700900123");
  });

  test("refuses what can't be a phone number", () => {
    for (const raw of ["12345", "803 123 4567", "+0 803", "phone", ""]) expect(normalizePhoneNumber(raw)).toBeNull();
  });
});

describe("fieldProblem: the checks a form makes as you type", () => {
  test("phone numbers", () => {
    expect(fieldProblem("phone", "0803 123 4567")).toBeNull();
    expect(fieldProblem("phone", "+44 20 7946 0958")).toBeNull();
    expect(fieldProblem("phone", "070578781111111111111111")).toMatch(/phone number/);
    expect(fieldProblem("phone", "12345")).toMatch(/phone number/);
    expect(phoneCharactersOnly("0803-abc 123 (4567)")).toBe("0803- 123 (4567)");
  });
  test("emails and web addresses", () => {
    expect(fieldProblem("email", "ops@example.ng")).toBeNull();
    expect(fieldProblem("email", "bob@")).toMatch(/email/);
    expect(fieldProblem("url", "https://example.ng")).toBeNull();
    expect(fieldProblem("url", "example.ng")).toMatch(/https:\/\//);
    expect(fieldProblem("url", "https://localhost")).toMatch(/https:\/\//);
  });
  test("names need letters; reference numbers need digits; blank is left to required", () => {
    expect(fieldProblem("name", "Central Bank of Nigeria")).toBeNull();
    expect(fieldProblem("name", "345666")).toMatch(/letters/);
    expect(fieldProblem("reference", "CBN/MFB/2019/045")).toBeNull();
    expect(fieldProblem("reference", "adewale")).toMatch(/digits/);
    expect(fieldProblem("reference", "   ")).toBeNull();
  });
});

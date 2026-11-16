import { describe, expect, test } from "vitest";
import { normalizePhoneNumber } from "./index";

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

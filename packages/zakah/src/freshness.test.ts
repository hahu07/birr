import { describe, expect, it } from "vitest";
import { priceFreshness } from "./freshness";

describe("priceFreshness", () => {
  it.each([
    ["2027-02-08", { ageDays: 0, status: "fresh" }],
    ["2027-02-15", { ageDays: 7, status: "fresh" }],
    ["2027-02-16", { ageDays: 8, status: "stale" }],
    ["2027-03-11", { ageDays: 31, status: "stale" }],
    ["2027-03-12", { ageDays: 32, status: "expired" }],
  ])("prices from 2027-02-08 on %s", (today, expected) => {
    expect(priceFreshness("2027-02-08", today)).toEqual(expected);
  });

  it("treats a future-dated price as fresh", () => {
    expect(priceFreshness("2027-02-10", "2027-02-08")).toEqual({ ageDays: 0, status: "fresh" });
  });

  it("rejects dates that aren't YYYY-MM-DD", () => {
    expect(() => priceFreshness("08/02/2027", "2027-02-08")).toThrow(expect.objectContaining({ field: "prices.asOf" }));
    expect(() => priceFreshness("2027-02-08", "2027-13-45")).toThrow(expect.objectContaining({ field: "today" }));
  });
});

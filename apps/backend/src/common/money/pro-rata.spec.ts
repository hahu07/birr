import { Prisma } from "@birr/db";
import { splitProRata } from "./pro-rata";

function sum(shares: Map<string, Prisma.Decimal>): Prisma.Decimal {
  return [...shares.values()].reduce((s, v) => s.plus(v), new Prisma.Decimal(0));
}

describe("splitProRata", () => {
  test("splits evenly when weights are equal", () => {
    const result = splitProRata(new Prisma.Decimal("300"), [
      { key: "a", weight: new Prisma.Decimal("100") },
      { key: "b", weight: new Prisma.Decimal("100") },
      { key: "c", weight: new Prisma.Decimal("100") },
    ]);
    expect(result.get("a")?.toString()).toBe("100");
    expect(result.get("b")?.toString()).toBe("100");
    expect(result.get("c")?.toString()).toBe("100");
  });

  test("sums to exactly the input total even when it doesn't divide evenly", () => {
    // 100 split three equal ways is 33.333... repeating — the classic
    // case a naive independent round drifts a cent off on.
    const total = new Prisma.Decimal("100");
    const result = splitProRata(total, [
      { key: "a", weight: new Prisma.Decimal("1") },
      { key: "b", weight: new Prisma.Decimal("1") },
      { key: "c", weight: new Prisma.Decimal("1") },
    ]);
    expect(sum(result).toString()).toBe(total.toString());
    // Every share gets at least the floor; exactly one gets the leftover cent.
    for (const v of result.values()) {
      expect(["33.33", "33.34"]).toContain(v.toString());
    }
  });

  test("weights proportionally, not evenly", () => {
    // 3:1 split of 1000 — 750/250, no remainder to distribute.
    const result = splitProRata(new Prisma.Decimal("1000"), [
      { key: "big", weight: new Prisma.Decimal("300") },
      { key: "small", weight: new Prisma.Decimal("100") },
    ]);
    expect(result.get("big")?.toString()).toBe("750");
    expect(result.get("small")?.toString()).toBe("250");
  });

  test("sums exactly even with many unevenly-weighted shares", () => {
    const total = new Prisma.Decimal("9999.99");
    const shares = [
      { key: "a", weight: new Prisma.Decimal("17") },
      { key: "b", weight: new Prisma.Decimal("83") },
      { key: "c", weight: new Prisma.Decimal("240") },
      { key: "d", weight: new Prisma.Decimal("1") },
      { key: "e", weight: new Prisma.Decimal("59") },
    ];
    const result = splitProRata(total, shares);
    expect(sum(result).toString()).toBe(total.toString());
    expect(result.size).toBe(shares.length);
  });

  test("a single share gets the whole total", () => {
    const result = splitProRata(new Prisma.Decimal("42.50"), [{ key: "only", weight: new Prisma.Decimal("1") }]);
    expect(result.get("only")?.toString()).toBe("42.5");
  });

  test("rejects an all-zero weight set", () => {
    expect(() =>
      splitProRata(new Prisma.Decimal("100"), [{ key: "a", weight: new Prisma.Decimal("0") }]),
    ).toThrow();
  });

  test("empty share list returns an empty split", () => {
    expect(splitProRata(new Prisma.Decimal("100"), []).size).toBe(0);
  });
});

import { prisma } from "@birr/db";
import { ImpactService, mergeByCurrency } from "./impact.service";

describe("mergeByCurrency", () => {
  it("adds same-currency totals exactly and never mixes currencies", () => {
    const out = mergeByCurrency(
      [{ currency: "NGN", amount: "0.1" }, { currency: "USD", amount: "5" }],
      [{ currency: "NGN", amount: "0.2" }, { currency: "EUR", amount: null }],
    );
    expect(out).toEqual([
      { currency: "USD", amount: "5" },
      { currency: "NGN", amount: "0.3" }, // 0.1 + 0.2, not 0.30000000000000004
    ]);
  });

  it("drops zero totals and orders largest first", () => {
    expect(mergeByCurrency([{ currency: "A", amount: "0" }, { currency: "B", amount: "2" }, { currency: "C", amount: "9" }]).map((r) => r.currency)).toEqual(["C", "B"]);
  });
});

// Runs against the shared dev database, so every assertion is a before/after
// DELTA on rows this test creates — never an absolute total.
describe("ImpactService.summary", () => {
  const service = new ImpactService();
  const stamp = Date.now();
  const vaultIds: string[] = [];

  afterAll(async () => {
    await prisma.vaultContribution.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.$disconnect();
  });

  const total = (rows: { currency: string; amount: string }[], currency: string) =>
    rows.find((r) => r.currency === currency)?.amount ?? "0";

  it("counts only gifts Birr actually holds: refunded and held gifts are not impact", async () => {
    const before = await service.summary();

    const staffUser = await prisma.user.create({ data: { email: `impact-staff-${stamp}@example.com`, fullName: "Impact Fixture Staff" } });
    const vault = await prisma.vault.create({
      data: { name: "Impact Fixture", slug: `impact-fixture-${stamp}`, type: "project", currency: "ZZI", jurisdiction: "NG", status: "open", createdByUserId: staffUser.id },
    });
    vaultIds.push(vault.id);
    const donor = await prisma.vaultDonor.create({ data: { email: `impact-donor-${stamp}@example.com` } });

    const gift = (amount: string, extra: Record<string, unknown> = {}) =>
      prisma.vaultContribution.create({
        data: { vaultId: vault.id, donorId: donor.id, amount, currency: "ZZI", status: "confirmed", provider: "paystack", providerReference: `ref-${Math.random()}`, ...extra } as any,
      });
    await gift("100"); // counts
    await gift("50"); // counts
    await gift("999", { refundStatus: "refunded" }); // returned to donor — must NOT count
    await gift("777", { heldAt: new Date() }); // under AML hold — must NOT count
    await gift("555", { status: "pending" }); // not confirmed — must NOT count

    const after = await service.summary();
    expect(after.giftsReceived - before.giftsReceived).toBe(2);
    expect(Number(total(after.givenByCurrency, "ZZI")) - Number(total(before.givenByCurrency, "ZZI"))).toBe(150);
    expect(after.fundsAndCampaigns - before.fundsAndCampaigns).toBe(1); // the open vault
  }, 30000);

  it("returns aggregates only — no donor, founder or staff identifiers", async () => {
    const summary = await service.summary();
    expect(Object.keys(summary).sort()).toEqual(["fundsAndCampaigns", "giftsReceived", "givenByCurrency", "paidOutByCurrency"]);
    expect(JSON.stringify(summary)).not.toMatch(/@|email|donor/i);
  });
});

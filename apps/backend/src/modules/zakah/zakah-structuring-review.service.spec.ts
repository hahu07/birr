import { prisma, Prisma } from "@birr/db";
import { randomUUID } from "crypto";
import { ZakahStructuringReviewService } from "./zakah-structuring-review.service";

// The review reads every NGN payment in the shared dev database, so each
// test uses its own emails and IPs and checks only for its own rows.
// Fixtures stay behind, as with every zakah spec.
describe("ZakahStructuringReviewService", () => {
  const service = new ZakahStructuringReviewService();
  const run = Date.now().toString(36);
  let threshold: Prisma.Decimal;
  let vaultId: string;

  async function payer(name: string) {
    return prisma.zakahPayer.create({ data: { email: `review-${name}-${run}@example.com`, fullName: `Review ${name}` } });
  }

  async function zakahPayment(amount: Prisma.Decimal | string, payerId: string | null, ipAddress?: string) {
    const id = randomUUID();
    return prisma.zakahPayment.create({
      data: {
        id, amount, currency: "NGN", payerId, ipAddress, provider: "paystack", providerReference: id, status: "confirmed",
        confirmedAt: new Date(), settlementSubaccount: "ACCT_test_zakah", wakalahConsentVersion: "test",
      },
    });
  }

  async function vaultGift(email: string, amount: Prisma.Decimal | string, ipAddress?: string) {
    const donor = await prisma.vaultDonor.upsert({ where: { email }, update: {}, create: { email } });
    const id = randomUUID();
    return prisma.vaultContribution.create({
      data: { id, vaultId, donorId: donor.id, amount, currency: "NGN", provider: "paystack", providerReference: id, status: "confirmed", confirmedAt: new Date(), ipAddress },
    });
  }

  beforeAll(async () => {
    threshold = (await prisma.vaultDonorThreshold.findUniqueOrThrow({ where: { currency: "NGN" } })).thresholdAmount;
    const user = await prisma.user.create({ data: { email: `review-staff-${run}@example.com`, fullName: "Review Staff" } });
    vaultId = (
      await prisma.vault.create({
        data: { name: `Review Fixture Vault ${run}`, slug: `review-fixture-${run}`, type: "project", currency: "NGN", jurisdiction: "NG", createdByUserId: user.id },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("flags different payers each paying close to the threshold into the same pool, not small payments", async () => {
    const [a, b] = [await payer("near-a"), await payer("near-b")];
    const near1 = await zakahPayment(threshold.times(0.6).toDecimalPlaces(2), a.id);
    const near2 = await zakahPayment(threshold.times(0.6).toDecimalPlaces(2), b.id);
    const small = await zakahPayment(threshold.times(0.1).toDecimalPlaces(2), a.id);

    const { nearThreshold } = await service.review();
    const mal = nearThreshold.find((g) => g.pool === "mal")!;
    const ids = mal.payments.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([near1.id, near2.id]));
    expect(ids).not.toContain(small.id);
    expect(mal.distinctPayerCount).toBeGreaterThanOrEqual(2);
  });

  test("flags a network shared by different payers, but not one payer paying twice", async () => {
    const [a, b, c] = [await payer("ip-a"), await payer("ip-b"), await payer("ip-c")];
    await zakahPayment("5000", a.id, `shared-${run}`);
    await zakahPayment("7000", b.id, `shared-${run}`);
    await zakahPayment("5000", c.id, `solo-${run}`);
    await zakahPayment("6000", c.id, `solo-${run}`);

    const { ipClusters } = await service.review();
    expect(ipClusters.find((x) => x.ipAddress === `shared-${run}`)).toMatchObject({ distinctPayerCount: 2 });
    expect(ipClusters.find((x) => x.ipAddress === `solo-${run}`)).toBeUndefined();
  });

  test("flags the same email giving to both Vault and zakah when the combined NGN total reaches the threshold", async () => {
    const both = await payer("both");
    await zakahPayment(threshold.times(0.6).toDecimalPlaces(2), both.id);
    await vaultGift(both.email, threshold.times(0.5).toDecimalPlaces(2));
    const small = await payer("both-small");
    await zakahPayment("1000", small.id);
    await vaultGift(small.email, "1000");

    const { acrossVault } = await service.review();
    const flagged = acrossVault.sameEmail.find((m) => m.email === both.email)!;
    expect(flagged).toMatchObject({
      zakahTotal: threshold.times(0.6).toFixed(2),
      vaultTotal: threshold.times(0.5).toFixed(2),
      combinedTotal: threshold.times(1.1).toFixed(2),
    });
    expect(flagged.vault[0].vaultName).toBe(`Review Fixture Vault ${run}`);
    expect(acrossVault.sameEmail.find((m) => m.email === small.email)).toBeUndefined();
  });

  test("flags a network used by a Vault donor and a zakah payer under different emails, not one person giving to both", async () => {
    const z = await payer("net-zakah");
    await zakahPayment("3000", z.id, `cross-${run}`);
    await vaultGift(`review-net-vault-${run}@example.com`, "4000", `cross-${run}`);
    const same = await payer("net-same");
    await zakahPayment("3000", same.id, `own-${run}`);
    await vaultGift(same.email, "4000", `own-${run}`);

    const { acrossVault } = await service.review();
    expect(acrossVault.sharedNetworks.find((n) => n.ipAddress === `cross-${run}`)).toMatchObject({ distinctEmailCount: 2 });
    expect(acrossVault.sharedNetworks.find((n) => n.ipAddress === `own-${run}`)).toBeUndefined();
  });

  test("shows whether a flagged payment is already on hold, and never anything beyond name, email and whether ID is on file", async () => {
    const [a, b] = [await payer("hold-a"), await payer("hold-b")];
    await zakahPayment("2000", a.id, `held-${run}`);
    await zakahPayment("2000", b.id, `held-${run}`);
    const { ipClusters } = await service.review();
    const payment = ipClusters.find((x) => x.ipAddress === `held-${run}`)!.payments[0];
    expect(Object.keys(payment).sort()).toEqual(
      ["amount", "createdAt", "heldAt", "id", "payerEmail", "payerFullName", "payerId", "payerIdCaptured", "pool"].sort(),
    );
  });
});

import { prisma, Prisma } from "@birr/db";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EncryptionService } from "../../common/settings/encryption.service";
import type { SettingsService } from "../../common/settings/settings.service";
import type { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import { zakahTotals } from "./zakah-commitments";
import { ZakahFitrService } from "./zakah-fitr.service";
import { ZakahLedgerService } from "./zakah-ledger.service";
import { ZakahPaymentsService } from "./zakah-payments.service";
import type { ResendZakahReceiptEmailAdapter } from "./zakah-receipt-email.adapter";
import { ZakahRefundsService } from "./zakah-refunds.service";

// AML holds. Fixture payments use a made-up per-run currency, so this
// suite's spending limit is its own pool (see zakah-refunds.service.spec.ts)
// and "refused once committed" is deterministic. Rows stay behind, as with
// every zakah spec: payments, refunds and distributions are never deleted.
describe("AML holds on zakah payments", () => {
  const encryption = new EncryptionService();
  const ledger = new ZakahLedgerService();
  const payments = new ZakahPaymentsService(
    encryption,
    { get: async () => undefined } as unknown as SettingsService,
    {} as PaystackAdapter,
    ledger,
    {} as ResendZakahReceiptEmailAdapter,
    new ZakahFitrService(),
  );
  const refunds = new ZakahRefundsService(encryption, ledger, {} as ResendZakahReceiptEmailAdapter);
  const run = Date.now().toString(36).toUpperCase();
  const currency = `H${run}`;

  let officerUserId: string;
  let complianceUserId: string;

  async function confirmedPayment(amount: string) {
    const id = randomUUID();
    return prisma.zakahPayment.create({
      data: {
        id, amount, currency, provider: "paystack", providerReference: id, status: "confirmed", confirmedAt: new Date(),
        settlementSubaccount: "ACCT_test_zakah", wakalahConsentVersion: "test",
      },
    });
  }

  async function available() {
    const t = await zakahTotals(prisma, currency, "mal");
    return t.received.minus(t.committed);
  }

  /** Commits everything still available in this suite's pool except `leave`. */
  async function commitAllBut(leave: string) {
    const recipient = await prisma.zakahRecipient.create({
      data: { name: "Fixture", categories: ["fuqara"], eligibilityReason: "Fixture for the hold tests.", createdByUserId: officerUserId },
    });
    const amount = (await available()).minus(leave);
    if (amount.gt(0)) {
      await prisma.zakahDistribution.create({
        data: { recipientId: recipient.id, category: "fuqara", amount, currency, reason: "Fixture commitment.", createdByUserId: officerUserId },
      });
    }
  }

  beforeAll(async () => {
    const officer = await prisma.user.create({ data: { email: `zakah-hold-officer-${run}@example.com`, fullName: "Test Hold Officer" } });
    officerUserId = officer.id;
    await prisma.birrStaff.create({ data: { userId: officer.id, roles: { create: { role: "mutawalli_officer" } } } });
    const compliance = await prisma.user.create({ data: { email: `zakah-hold-compliance-${run}@example.com`, fullName: "Test Hold Compliance" } });
    complianceUserId = compliance.id;
    await prisma.birrStaff.create({ data: { userId: compliance.id, roles: { create: { role: "compliance_officer" } } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("a hold reserves the payment's zakah, so it can't be distributed, and is audited with its reason", async () => {
    const payment = await confirmedPayment("40000");
    const before = await available();

    const held = await payments.hold(payment.id, { reason: "Same card used under five different emails today." }, officerUserId);
    expect(held).toMatchObject({ heldReason: "Same card used under five different emails today.", heldByUserId: officerUserId });
    expect(before.minus(await available()).toFixed(2)).toBe("40000.00");

    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: payment.id, action: "zakah_payment.held" } });
    expect(log).toMatchObject({ actorType: "birr_staff", actorUserId: officerUserId });
  });

  test("releasing gives it back to the pool, audited", async () => {
    const payment = await confirmedPayment("25000");
    await payments.hold(payment.id, { reason: "Checking the payer's identity documents." }, officerUserId);
    const whileHeld = await available();

    const released = await payments.release(payment.id, complianceUserId);
    expect(released).toMatchObject({ heldAt: null, heldReason: null, heldByUserId: null });
    expect((await available()).minus(whileHeld).toFixed(2)).toBe("25000.00");
    expect(await prisma.auditLog.count({ where: { entityId: payment.id, action: "zakah_payment.hold_released", actorUserId: complianceUserId } })).toBe(1);
  });

  test("is refused once the zakah is already committed to recipients", async () => {
    const payment = await confirmedPayment("10000");
    await commitAllBut("6000");
    await expect(payments.hold(payment.id, { reason: "Suspicious pattern found too late." }, officerUserId)).rejects.toThrow(
      /already been committed to recipients/,
    );
    expect((await prisma.zakahPayment.findUniqueOrThrow({ where: { id: payment.id } })).heldAt).toBeNull();
  });

  test("only a confirmed payment can be held, only once, and only a held one released", async () => {
    const id = randomUUID();
    await prisma.zakahPayment.create({
      data: { id, amount: "500", currency, provider: "paystack", providerReference: id, settlementSubaccount: "ACCT_test_zakah", wakalahConsentVersion: "test" },
    });
    await expect(payments.hold(id, { reason: "A pending payment, held too early." }, officerUserId)).rejects.toThrow(BadRequestException);

    const payment = await confirmedPayment("1000");
    await payments.hold(payment.id, { reason: "First hold on this payment." }, officerUserId);
    await expect(payments.hold(payment.id, { reason: "Second hold on the same payment." }, officerUserId)).rejects.toThrow(ConflictException);
    const other = await confirmedPayment("1000");
    await expect(payments.release(other.id, complianceUserId)).rejects.toThrow(/isn't on hold/);
  });

  test("a held payment can still be refunded: the refund takes over the hold's reservation", async () => {
    const payment = await confirmedPayment("30000");
    await payments.hold(payment.id, { reason: "Card reported stolen by its owner." }, officerUserId);
    // Nothing else in the pool is free, so only the hold's own money could fund the refund.
    await commitAllBut("0");
    const committedBefore = (await zakahTotals(prisma, currency, "mal")).committed;

    const refund = await refunds.create(
      {
        paymentId: payment.id, amount: "30000", reason: "unauthorised_payment", details: "The card's owner says they never made this payment.",
        bankName: "Test Bank", accountNumber: "0123456789", accountName: "Card Owner",
      },
      complianceUserId,
    );
    expect(refund.status).toBe("pending_approval");
    expect((await zakahTotals(prisma, currency, "mal")).committed.toFixed(2)).toBe(committedBefore.toFixed(2));
  });

  test("a payer never sees a hold: the public status has no hold fields", async () => {
    const payment = await confirmedPayment("2000");
    await payments.hold(payment.id, { reason: "Reviewing an unusual pattern." }, officerUserId);
    const view = await payments.findPublicStatus(payment.id);
    expect(view).toMatchObject({ status: "confirmed" });
    expect(Object.keys(view!)).not.toEqual(expect.arrayContaining(["heldAt"]));
    expect(JSON.stringify(view)).not.toContain("Reviewing an unusual pattern");
  });

  // Straight to the database.
  test("the database refuses a hold without its reason and holder, or on an unconfirmed payment", async () => {
    const payment = await confirmedPayment("1000");
    await expect(prisma.zakahPayment.update({ where: { id: payment.id }, data: { heldAt: new Date() } })).rejects.toThrow();
    const id = randomUUID();
    await prisma.zakahPayment.create({
      data: { id, amount: "500", currency, provider: "paystack", providerReference: id, settlementSubaccount: "ACCT_test_zakah", wakalahConsentVersion: "test" },
    });
    await expect(
      prisma.zakahPayment.update({ where: { id }, data: { heldAt: new Date(), heldReason: "x", heldByUserId: officerUserId } }),
    ).rejects.toThrow();
  });

  test("the summary reports how much is held", async () => {
    const t = await zakahTotals(prisma, currency, "mal");
    expect(t.held.gt(new Prisma.Decimal(0))).toBe(true);
  });
});

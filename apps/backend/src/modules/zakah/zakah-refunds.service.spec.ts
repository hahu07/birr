import { prisma, Prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EncryptionService } from "../../common/settings/encryption.service";
import { ZAKAH_BANK_ACCOUNT_CODE, ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE, ZakahLedgerService } from "./zakah-ledger.service";
import { ZakahRefundsService } from "./zakah-refunds.service";
import type { ResendZakahReceiptEmailAdapter, ZakahRefundNotice } from "./zakah-receipt-email.adapter";

// Fixture payments here use a made-up per-run currency. The spending limit
// is per currency, so this suite gets its own pool: "can't refund what's
// committed to recipients" stays deterministic even while other suites
// add NGN payments in parallel, and the real NGN figures are untouched.
// Rows stay behind (append-only by design), like every other zakah spec.
describe("ZakahRefundsService", () => {
  const encryption = new EncryptionService();
  const ledger = new ZakahLedgerService();
  const notices: ZakahRefundNotice[] = [];
  const email = { sendRefundNotice: async (n: ZakahRefundNotice) => void notices.push(n) } as unknown as ResendZakahReceiptEmailAdapter;
  const service = new ZakahRefundsService(encryption, ledger, email);
  const run = Date.now().toString(36).toUpperCase();
  const currency = `T${run}`;

  let complianceUserId: string;
  let checkerUserId: string;

  const bank = { bankName: "Test Bank", accountNumber: "0123456789", accountName: "Amina Bello" };

  async function confirmedPayment(amount: string, feeCover = "0", payerId?: string) {
    return prisma.$transaction(async (tx) => {
      const id = randomUUID();
      const payment = await tx.zakahPayment.create({
        data: {
          id, amount, feeCover, currency, payerId, provider: "paystack", providerReference: id, status: "confirmed",
          confirmedAt: new Date(), settlementSubaccount: "ACCT_test_zakah", wakalahConsentVersion: "test",
        },
      });
      const bankAccount = await ledger.getAccountByCode(tx, ZAKAH_BANK_ACCOUNT_CODE);
      const held = await ledger.getAccountByCode(tx, ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE);
      await ledger.post(tx, {
        description: "Test fixture zakah payment", currency, source: "payment", sourceId: id, actorType: "system",
        lines: [{ ledgerAccountId: bankAccount.id, debit: amount }, { ledgerAccountId: held.id, credit: amount }],
      });
      return payment;
    });
  }

  async function governedAction(permissionKey: string, payload: object) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } });
    return prisma.governedAction.create({
      data: { permissionId: permission.id, makerType: "human", makerUserId: complianceUserId, checkerUserId, status: "approved", decidedAt: new Date(), payload },
    });
  }

  function request(paymentId: string, amount: string, reason: "duplicate_payment" | "wrong_amount" | "unauthorised_payment" = "duplicate_payment") {
    return service.create({ paymentId, amount, reason, details: "The payer paid the same zakah twice in one minute.", ...bank }, complianceUserId);
  }

  async function approve(refundId: string) {
    const action = await governedAction("zakah.refund_approve", { refundId });
    return prisma.$transaction((tx) => service.approve({ refundId }, action.id, tx));
  }

  beforeAll(async () => {
    const compliance = await prisma.user.create({ data: { email: `zakah-refund-compliance-${run}@example.com`, fullName: "Test Compliance" } });
    complianceUserId = compliance.id;
    await prisma.birrStaff.create({ data: { userId: compliance.id, roles: { create: { role: "compliance_officer" } } } });
    const board = await prisma.user.create({ data: { email: `zakah-refund-board-${run}@example.com`, fullName: "Test Board" } });
    checkerUserId = board.id;
    await prisma.birrStaff.create({ data: { userId: board.id, roles: { create: { role: "board_of_trustees" } } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("a request is audited without the payer's bank details, and lists show only the last four digits", async () => {
    const payment = await confirmedPayment("95000");
    const refund = await request(payment.id, "95000");

    expect(refund).toMatchObject({ status: "pending_approval", amount: new Prisma.Decimal(95000), currency, payeeBank: { bankName: "Test Bank", accountLast4: "6789" } });
    expect(refund).not.toHaveProperty("payeeBankDetailsEncrypted");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: refund.id, action: "zakah_refund.created" } });
    expect(JSON.stringify(log.after)).not.toContain("payeeBankDetailsEncrypted");
    expect(JSON.stringify(log.after)).not.toContain("0123456789");
  });

  test("the payer's full bank details are a separate, audited read", async () => {
    const payment = await confirmedPayment("1000");
    const refund = await request(payment.id, "1000");
    expect(await service.bankDetails(refund.id, complianceUserId)).toEqual(bank);
    expect(await prisma.auditLog.count({ where: { entityId: refund.id, action: "zakah_refund.bank_details_viewed" } })).toBe(1);
  });

  test("refunds only the zakah — never the fee cover — and never more than was paid across all its refunds", async () => {
    const payment = await confirmedPayment("95000", "1548.23");
    await expect(request(payment.id, "95000.01")).rejects.toThrow(/At most ₦95,000.00/);

    await request(payment.id, "60000", "wrong_amount");
    await expect(request(payment.id, "35000.01", "wrong_amount")).rejects.toThrow(/At most ₦35,000.00/);
    await expect(request(payment.id, "35000", "wrong_amount")).resolves.toMatchObject({ status: "pending_approval" });
  });

  test("only a confirmed payment can be refunded", async () => {
    const id = randomUUID();
    await prisma.zakahPayment.create({
      data: { id, amount: "500", currency, provider: "paystack", providerReference: id, settlementSubaccount: "ACCT_test_zakah", wakalahConsentVersion: "test" },
    });
    await expect(request(id, "500")).rejects.toThrow(/Only a confirmed payment/);
  });

  test("zakah already committed to recipients can't be refunded", async () => {
    const payment = await confirmedPayment("10000");
    // Commit everything still available in this suite's currency to a recipient.
    const recipient = await prisma.zakahRecipient.create({
      data: { name: "Fixture", categories: ["fuqara"], eligibilityReason: "Fixture for the refund limit test.", createdByUserId: complianceUserId },
    });
    const [received, distributed, refunded] = await Promise.all([
      prisma.zakahPayment.aggregate({ where: { currency, status: "confirmed" }, _sum: { amount: true } }),
      prisma.zakahDistribution.aggregate({ where: { currency, status: { not: "rejected" } }, _sum: { amount: true } }),
      prisma.zakahRefund.aggregate({ where: { currency, status: { not: "rejected" } }, _sum: { amount: true } }),
    ]);
    const available = received._sum.amount!.minus(distributed._sum.amount ?? 0).minus(refunded._sum.amount ?? 0);
    await prisma.zakahDistribution.create({
      data: { recipientId: recipient.id, category: "fuqara", amount: available.minus(4000), currency, reason: "Fixture commitment.", createdByUserId: complianceUserId },
    });

    await expect(request(payment.id, "4000.01")).rejects.toThrow(/Only ₦4,000.00 of zakah isn't already committed/);
    await expect(request(payment.id, "4000")).resolves.toMatchObject({ status: "pending_approval" });
  });

  test("approve → paid books the refund out of the zakah account; rejecting releases it", async () => {
    const payment = await confirmedPayment("20000");
    const refund = await request(payment.id, "20000");
    const approved = await approve(refund.id);
    expect(approved.after).toMatchObject({ status: "approved", approvalActionId: expect.any(String) });
    expect(approved.after).not.toHaveProperty("payeeBankDetailsEncrypted");

    const payload = { refundId: refund.id, bankReference: `RF-${run}`, paidOn: new Date().toISOString().slice(0, 10) };
    const paidAction = await governedAction("zakah.refund_mark_paid", payload);
    const paid = await prisma.$transaction((tx) => service.markPaid(payload, paidAction.id, tx));
    expect(paid.after).toMatchObject({ status: "paid", bankReference: `RF-${run}` });

    const entry = await prisma.zakahJournalEntry.findFirstOrThrow({
      where: { source: "refund", sourceId: refund.id },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(entry.description).toContain("paid twice by mistake");
    expect(entry.lines.map((l) => ({ code: l.ledgerAccount.code, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2) }))).toEqual(
      expect.arrayContaining([
        { code: "2000", debit: "20000.00", credit: "0.00" },
        { code: "1000", debit: "0.00", credit: "20000.00" },
      ]),
    );

    // Rejecting a different one releases it: the payment can be refunded again.
    const other = await confirmedPayment("3000");
    const first = await request(other.id, "3000");
    await expect(request(other.id, "3000")).rejects.toThrow(BadRequestException);
    await prisma.$transaction((tx) => service.reject({ refundId: first.id }, tx));
    await expect(request(other.id, "3000")).resolves.toMatchObject({ status: "pending_approval" });
  });

  test("only an approved refund can be marked paid, and not with a future date", async () => {
    const payment = await confirmedPayment("1000");
    const refund = await request(payment.id, "1000");
    await expect(service.validatePaidProposalAsync({ refundId: refund.id, bankReference: "RF-1", paidOn: "2026-01-01" })).rejects.toThrow(
      /Only an approved refund/,
    );
    expect(() => service.validatePaidProposal({ refundId: refund.id, bankReference: "RF-1", paidOn: "2999-01-01" })).toThrow(/future/);
  });

  test("the payer is emailed when the refund is approved and when it's paid — never why", async () => {
    const payer = await prisma.zakahPayer.create({ data: { email: `zakah-refund-payer-${run}@example.com` } });
    const payment = await confirmedPayment("12000", "0", payer.id);
    const refund = await request(payment.id, "12000");
    await approve(refund.id);
    await service.notifyPayer(refund.id, "approved");

    const payload = { refundId: refund.id, bankReference: `RN-${run}`, paidOn: new Date().toISOString().slice(0, 10) };
    const paidAction = await governedAction("zakah.refund_mark_paid", payload);
    await prisma.$transaction((tx) => service.markPaid(payload, paidAction.id, tx));
    await service.notifyPayer(refund.id, "paid");

    const sent = notices.filter((n) => n.refundId === refund.id);
    expect(sent).toEqual([
      expect.objectContaining({ to: payer.email, stage: "approved", amount: "12000.00", accountLast4: "6789" }),
      expect.objectContaining({ stage: "paid", bankReference: `RN-${run}`, paidOn: payload.paidOn }),
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/duplicate|twice|unauthori[sz]ed|wrong/i);
  });

  test("a payer who gave no email isn't emailed", async () => {
    const payment = await confirmedPayment("3000");
    const refund = await request(payment.id, "3000");
    await service.notifyPayer(refund.id, "approved");
    expect(notices.some((n) => n.refundId === refund.id)).toBe(false);
  });

  // Straight to the database: it enforces these itself.
  test("a refund's amount and payee account never change, it's never deleted, and it can't skip approval", async () => {
    const payment = await confirmedPayment("1000");
    const refund = await request(payment.id, "1000");
    await expect(prisma.zakahRefund.update({ where: { id: refund.id }, data: { amount: "1" } })).rejects.toThrow(/never change/);
    await expect(prisma.zakahRefund.update({ where: { id: refund.id }, data: { payeeBankDetailsEncrypted: "x" } })).rejects.toThrow(/never change/);
    await expect(prisma.zakahRefund.delete({ where: { id: refund.id } })).rejects.toThrow(/never deleted/);
    const action = await governedAction("zakah.refund_mark_paid", {});
    await expect(
      prisma.zakahRefund.update({ where: { id: refund.id }, data: { status: "paid", bankReference: "X", paidOn: new Date(), paymentActionId: action.id } }),
    ).rejects.toThrow(/can't go from pending_approval to paid/);
  });
});

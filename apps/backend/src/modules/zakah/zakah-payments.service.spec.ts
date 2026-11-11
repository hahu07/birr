import { prisma, Prisma } from "@birr/db";
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EncryptionService } from "../../common/settings/encryption.service";
import type { SettingsService } from "../../common/settings/settings.service";
import type { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import type { CreatePaymentInput, VerifiedPayment, WebhookResult } from "../contributions/providers/payment-provider.interface";
import { ZakahLedgerService } from "./zakah-ledger.service";
import { ZakahPaymentsService } from "./zakah-payments.service";
import type { ResendZakahReceiptEmailAdapter, ZakahReceipt } from "./zakah-receipt-email.adapter";
import { ZAKAH_WAKALAH_TERMS } from "./zakah-terms";

// A fake Paystack: records what would be sent, and lets each test decide
// what the "webhook" or "verify" call reports. Nothing reaches Paystack.
class FakePaystack {
  created: CreatePaymentInput[] = [];
  nextWebhook: WebhookResult | null = null;
  nextVerify: VerifiedPayment | null = null;

  async createPayment(input: CreatePaymentInput) {
    this.created.push(input);
    return { providerReference: input.reference, clientPayload: { checkoutUrl: "https://checkout.paystack.test/x" } };
  }
  async verifyAndParseWebhook() {
    return this.nextWebhook;
  }
  async verifyPayment() {
    return this.nextVerify;
  }
}

class FakeReceipts {
  sent: ZakahReceipt[] = [];
  async sendReceipt(input: ZakahReceipt) {
    this.sent.push(input);
  }
}

// Zakah payments and journal entries are append-only by design, so these
// fixtures stay in the shared dev database, identifiable by their
// per-run emails — same posture as every other spec here.
describe("ZakahPaymentsService", () => {
  const run = Date.now().toString(36);
  let subaccount: string | undefined = "ACCT_test_zakah";
  const settings = {
    get: async (provider: string, key: string) => (provider === "paystack" && key === "ZAKAH_SUBACCOUNT_CODE" ? subaccount : undefined),
  } as unknown as SettingsService;
  const paystack = new FakePaystack();
  const receipts = new FakeReceipts();
  const encryption = new EncryptionService();
  const service = new ZakahPaymentsService(
    encryption,
    settings,
    paystack as unknown as PaystackAdapter,
    new ZakahLedgerService(),
    receipts as unknown as ResendZakahReceiptEmailAdapter,
  );

  const base = { amount: "95000", coverFee: false, wakalahConsentVersion: ZAKAH_WAKALAH_TERMS.version };
  const email = (name: string) => `zakah-${name}-${run}@example.com`;

  beforeEach(() => {
    subaccount = "ACCT_test_zakah";
    paystack.nextWebhook = null;
    paystack.nextVerify = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function confirmViaWebhook(paymentId: string) {
    paystack.nextWebhook = { providerReference: paymentId, status: "confirmed", providerPaymentId: "ps-1" };
    return service.handleWebhook("paystack", Buffer.from("{}"), {});
  }

  describe("before the zakah account is set up", () => {
    test("paymentTerms() says payments aren't open, and gives the current wording", async () => {
      subaccount = undefined;
      expect(await service.paymentTerms()).toMatchObject({ available: false, currency: "NGN", wakalah: ZAKAH_WAKALAH_TERMS });
    });

    test("initiate() refuses, so zakah never settles into Birr's main account", async () => {
      subaccount = undefined;
      await expect(service.initiate({ ...base })).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe("starting a payment", () => {
    test("routes the zakah to the zakah subaccount, with nothing kept back when the payer doesn't cover the fee", async () => {
      const { payment, clientPayload } = await service.initiate({ ...base, payerEmail: email("plain") });

      expect(payment).toMatchObject({ amount: "95000.00", feeCover: "0.00", currency: "NGN", status: "pending" });
      expect(clientPayload).toEqual({ checkoutUrl: "https://checkout.paystack.test/x" });
      expect(paystack.created.at(-1)).toMatchObject({
        amount: "95000.00",
        currency: "NGN",
        reference: payment.id,
        returnPath: "zakah-payments",
        split: { subaccount: "ACCT_test_zakah", mainAccountShareMinorUnits: 0 },
      });
      const row = await prisma.zakahPayment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(row).toMatchObject({ settlementSubaccount: "ACCT_test_zakah", wakalahConsentVersion: ZAKAH_WAKALAH_TERMS.version });
      const logs = await prisma.auditLog.findMany({ where: { entityId: payment.id, action: "zakah_payment.initiated" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].actorType).toBe("public_donor");
    });

    test("adds the fee cover on top, and keeps only that in Birr's main account", async () => {
      const { payment } = await service.initiate({ ...base, coverFee: true });

      expect(payment).toMatchObject({ amount: "95000.00", feeCover: "1548.23" });
      expect(paystack.created.at(-1)).toMatchObject({
        amount: "96548.23",
        split: { subaccount: "ACCT_test_zakah", mainAccountShareMinorUnits: 154823 },
      });
    });

    test("refuses wording other than the current version", async () => {
      await expect(service.initiate({ ...base, wakalahConsentVersion: "2020-01-01" })).rejects.toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: "WAKALAH_TERMS_CHANGED" }) }),
      );
    });

    test.each([["99.99"], ["100.001"]])("refuses ₦%s", async (amount) => {
      await expect(service.initiate({ ...base, amount })).rejects.toThrow(BadRequestException);
    });

    test("refuses a ruleset version that doesn't exist", async () => {
      await expect(service.initiate({ ...base, rulesetKey: `missing-${run}`, rulesetVersion: 1 })).rejects.toThrow(BadRequestException);
    });

    test("marks the payment failed if Paystack can't start it", async () => {
      const original = paystack.createPayment;
      let reference = "";
      paystack.createPayment = async (input) => {
        reference = input.reference;
        throw new Error("Paystack is down");
      };
      try {
        await expect(service.initiate({ ...base })).rejects.toThrow("Paystack is down");
      } finally {
        paystack.createPayment = original;
      }
      expect((await prisma.zakahPayment.findUniqueOrThrow({ where: { id: reference } })).status).toBe("failed");
    });
  });

  describe("confirming a payment", () => {
    test("books only the zakah as held for recipients, audits it, and emails a receipt", async () => {
      const { payment } = await service.initiate({ ...base, coverFee: true, payerEmail: email("confirm") });
      const confirmed = await confirmViaWebhook(payment.id);

      expect(confirmed).toMatchObject({ id: payment.id, status: "confirmed" });
      const entries = await prisma.zakahJournalEntry.findMany({
        where: { source: "payment", sourceId: payment.id },
        include: { lines: { include: { ledgerAccount: true } } },
      });
      expect(entries).toHaveLength(1);
      const lines = entries[0].lines.map((l) => ({ code: l.ledgerAccount.code, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2) }));
      expect(lines).toEqual(
        expect.arrayContaining([
          { code: "1000", debit: "95000.00", credit: "0.00" },
          { code: "2000", debit: "0.00", credit: "95000.00" },
        ]),
      );
      expect(await prisma.auditLog.count({ where: { entityId: payment.id, action: "zakah_payment.confirmed" } })).toBe(1);
      await new Promise((r) => setImmediate(r));
      expect(receipts.sent).toContainEqual({ to: email("confirm"), amount: "95000.00", feeCover: "1548.23", paymentId: payment.id });
    });

    test("a retried webhook never posts the money twice", async () => {
      const { payment } = await service.initiate({ ...base });
      await Promise.all([confirmViaWebhook(payment.id), confirmViaWebhook(payment.id)]);
      await confirmViaWebhook(payment.id);

      expect(await prisma.zakahJournalEntry.count({ where: { source: "payment", sourceId: payment.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: payment.id, action: "zakah_payment.confirmed" } })).toBe(1);
    });

    test("a failed charge is marked failed with nothing booked", async () => {
      const { payment } = await service.initiate({ ...base });
      paystack.nextWebhook = { providerReference: payment.id, status: "failed" };
      expect(await service.handleWebhook("paystack", Buffer.from("{}"), {})).toMatchObject({ status: "failed" });
      expect(await prisma.zakahJournalEntry.count({ where: { sourceId: payment.id } })).toBe(0);
    });

    test("an anonymous payment is confirmed without a receipt", async () => {
      const before = receipts.sent.length;
      const { payment } = await service.initiate({ ...base });
      await confirmViaWebhook(payment.id);
      await new Promise((r) => setImmediate(r));
      expect(receipts.sent).toHaveLength(before);
    });

    test("handleWebhook() passes on what isn't a zakah payment, and rejects a bad signature", async () => {
      paystack.nextWebhook = { providerReference: randomUUID(), status: "confirmed" };
      expect(await service.handleWebhook("paystack", Buffer.from("{}"), {})).toBeNull();
      expect(await service.handleWebhook("stripe", Buffer.from("{}"), {})).toBeNull();
      paystack.nextWebhook = null;
      await expect(service.handleWebhook("paystack", Buffer.from("{}"), {})).rejects.toThrow(UnauthorizedException);
    });

    test("reconcile() leaves a payment pending when Paystack charged a different amount", async () => {
      const { payment } = await service.initiate({ ...base, coverFee: true });
      paystack.nextVerify = { status: "confirmed", amountMinorUnits: 9500000, currency: "NGN" };
      expect(await service.reconcile(payment.id)).toMatchObject({ status: "pending" });
    });

    test("reconcile() confirms when Paystack charged the zakah plus fee cover exactly", async () => {
      const { payment } = await service.initiate({ ...base, coverFee: true });
      paystack.nextVerify = { status: "confirmed", amountMinorUnits: 9654823, currency: "NGN", providerPaymentId: "ps-2" };
      expect(await service.reconcile(payment.id)).toMatchObject({ status: "confirmed" });
      expect(await prisma.zakahJournalEntry.count({ where: { source: "payment", sourceId: payment.id } })).toBe(1);
    });
  });

  describe("AML identity threshold", () => {
    let threshold: Prisma.Decimal;

    beforeAll(async () => {
      threshold = (await prisma.vaultDonorThreshold.findUniqueOrThrow({ where: { currency: "NGN" } })).thresholdAmount;
    });

    test("requires a name and ID once a payer reaches the NGN threshold", async () => {
      await expect(service.initiate({ ...base, amount: threshold.toFixed(2), payerEmail: email("aml") })).rejects.toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: "IDENTITY_REQUIRED" }) }),
      );
      const { payment } = await service.initiate({
        ...base,
        amount: threshold.toFixed(2),
        payerEmail: email("aml"),
        payerFullName: "Amina Bello",
        idType: "national_id",
        idNumber: "12345678901",
      });
      expect(payment.status).toBe("pending");

      const payer = await prisma.zakahPayer.findUniqueOrThrow({ where: { email: email("aml") } });
      expect(payer).toMatchObject({ fullName: "Amina Bello", idType: "national_id" });
      expect(encryption.decrypt(payer.idNumberEncrypted!)).toBe("12345678901");
      // The audit trail records that an ID exists, never the ID itself.
      const log = await prisma.auditLog.findFirst({ where: { entityId: payer.id, entityType: "ZakahPayer" } });
      expect(JSON.stringify(log!.after)).not.toContain("idNumberEncrypted");
    });

    test("past the threshold, the ID on file must be re-entered and match", async () => {
      await expect(
        service.initiate({ ...base, amount: "100", payerEmail: email("aml"), idType: "national_id", idNumber: "99999999999" }),
      ).rejects.toThrow(expect.objectContaining({ response: expect.objectContaining({ code: "IDENTITY_MISMATCH" }) }));
      await expect(
        service.initiate({ ...base, amount: "100", payerEmail: email("aml"), idType: "national_id", idNumber: "123 4567 8901" }),
      ).resolves.toMatchObject({ payment: { status: "pending" } });
    });
  });

  // Straight to the database, bypassing the service: these prove the
  // database itself keeps the money facts fixed.
  describe("database rules", () => {
    test("a payment's amount can't change, it can't be deleted, and a confirmed one can't be un-confirmed", async () => {
      const { payment } = await service.initiate({ ...base });
      await expect(prisma.zakahPayment.update({ where: { id: payment.id }, data: { amount: "1" } })).rejects.toThrow(/never change/);
      await expect(prisma.zakahPayment.delete({ where: { id: payment.id } })).rejects.toThrow(/never deleted/);
      await confirmViaWebhook(payment.id);
      await expect(prisma.zakahPayment.update({ where: { id: payment.id }, data: { status: "failed" } })).rejects.toThrow(
        /can't change status/,
      );
    });

    test("the zakah journal can't be edited or deleted", async () => {
      const { payment } = await service.initiate({ ...base });
      await confirmViaWebhook(payment.id);
      const entry = await prisma.zakahJournalEntry.findFirstOrThrow({ where: { sourceId: payment.id }, include: { lines: true } });
      await expect(prisma.zakahJournalEntry.update({ where: { id: entry.id }, data: { description: "edited" } })).rejects.toThrow(
        /append-only/,
      );
      await expect(prisma.zakahJournalEntryLine.update({ where: { id: entry.lines[0].id }, data: { debit: "1" } })).rejects.toThrow(
        /append-only/,
      );
    });

    test("ledger balances show the zakah held for recipients equal to the zakah in the bank", async () => {
      const balances = await service.ledgerBalances();
      const bank = balances.find((b) => b.code === "1000")!;
      const held = balances.find((b) => b.code === "2000")!;
      expect(bank.balance).toBe(held.balance);
      expect(Number(held.balance)).toBeGreaterThan(0);
    });
  });
});

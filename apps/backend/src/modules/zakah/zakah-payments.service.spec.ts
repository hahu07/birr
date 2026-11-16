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
import { ZakahFitrService } from "./zakah-fitr.service";
import { unusedFitrSeason } from "./test-support-fitr";
import { createFakeRecurringGiftsCore } from "../recurring-gifts/test-support/fake-recurring-gifts";
import { createGiverWhatsApp } from "../../common/whatsapp/test-support/fake-whatsapp";
import type { TwilioWhatsAppAdapter } from "../../common/whatsapp/twilio-whatsapp.adapter";

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
  const fitr = new ZakahFitrService();
  // Fitr campaigns here sit in January 2001 (see zakah-fitr.service.spec.ts).
  let fitrToday = "2001-01-15";
  fitr.now = () => new Date(`${fitrToday}T12:00:00Z`);
  const service = new ZakahPaymentsService(
    encryption,
    settings,
    paystack as unknown as PaystackAdapter,
    new ZakahLedgerService(),
    receipts as unknown as ResendZakahReceiptEmailAdapter,
    fitr,
    createFakeRecurringGiftsCore().core,
  );

  const base = { amount: "95000", coverFee: false, wakalahConsentVersion: ZAKAH_WAKALAH_TERMS.version };
  const email = (name: string) => `zakah-${name}-${run}@example.com`;

  beforeEach(() => {
    subaccount = "ACCT_test_zakah";
    paystack.nextWebhook = null;
    paystack.nextVerify = null;
  });

  afterAll(async () => {
    // Approved test rulesets would otherwise appear in the public
    // calculator's school list (dev database). Superseding is the one
    // change the database allows an approved ruleset.
    await prisma.zakahRuleset.updateMany({ where: { key: { startsWith: `test-${run}-` }, status: "approved" }, data: { status: "superseded" } });
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
      expect(receipts.sent).toContainEqual({ to: email("confirm"), amount: "95000.00", feeCover: "1548.23", paymentId: payment.id, pool: "mal", fitrPeople: null });
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

  describe("Zakah al-Fitr", () => {
    let hanafiKey: string;

    beforeAll(async () => {
      const officer = await prisma.user.create({ data: { email: email("fitr-officer"), fullName: "Fitr Officer" } });
      const shariah = await prisma.user.create({ data: { email: email("fitr-shariah"), fullName: "Fitr Shariah" } });
      const governed = async (key: string) => {
        const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
        return prisma.governedAction.create({
          data: { permissionId: permission.id, makerType: "human", makerUserId: officer.id, checkerUserId: shariah.id, status: "approved", decidedAt: new Date(), payload: {} },
        });
      };
      // A season's campaign: ₦2,500 a person, payments close 2001-01-19.
      const fields = { staple: "Rice", kgPerPerson: "2.5", amountPerPerson: "2500", opensOn: "2001-01-01", expectedEidOn: "2001-01-20" };
      const draft = await fitr.createDraft({ season: await unusedFitrSeason(), ...fields }, officer.id);
      const action = await governed("zakah.fitr_campaign_approve");
      await prisma.$transaction((tx) => fitr.approve({ campaignId: draft.id, ...fields }, action.id, shariah.id, tx));
      // An approved Hanafi ruleset, for paying fitr as cash.
      hanafiKey = `test-${run}-hanafi`;
      await prisma.zakahRuleset.create({
        data: {
          key: hanafiKey, madhhab: "hanafi", version: 1, label: "Hanafi", status: "approved", approvedAt: new Date(),
          approvedGovernedActionId: (await governed("zakah.ruleset_approve")).id, createdByUserId: officer.id,
          rulings: { personalJewellery: "zakatable", debts: "deduct", nisabBasis: "silver", nisabGoldGrams: "85", nisabSilverGrams: "595" },
        },
      });
    });

    afterEach(() => {
      fitrToday = "2001-01-15";
    });

    test("food: people × the campaign's amount — never a figure from the client — booked to the food pool", async () => {
      const { payment } = await service.initiate({ ...base, kind: "fitr", amount: "1", fitrPeople: 4, fitrForm: "food" });
      expect(payment).toMatchObject({ amount: "10000.00", pool: "fitr_food", fitrPeople: 4 });
      expect(paystack.created.at(-1)).toMatchObject({ amount: "10000.00", split: { subaccount: "ACCT_test_zakah" } });

      await confirmViaWebhook(payment.id);
      const entry = await prisma.zakahJournalEntry.findFirstOrThrow({
        where: { source: "payment", sourceId: payment.id },
        include: { lines: { include: { ledgerAccount: true } } },
      });
      expect(entry.lines.map((l) => l.ledgerAccount.code).sort()).toEqual(["1000", "2100"]);
    });

    test("cash only under an approved Hanafi ruleset, booked to the cash pool", async () => {
      await expect(service.initiate({ ...base, kind: "fitr", fitrPeople: 2, fitrForm: "cash" })).rejects.toThrow(/only offered under the Hanafi ruleset/);
      const { payment } = await service.initiate({ ...base, kind: "fitr", fitrPeople: 2, fitrForm: "cash", rulesetKey: hanafiKey, rulesetVersion: 1 });
      expect(payment).toMatchObject({ amount: "5000.00", pool: "fitr_cash" });

      await confirmViaWebhook(payment.id);
      const entry = await prisma.zakahJournalEntry.findFirstOrThrow({
        where: { source: "payment", sourceId: payment.id },
        include: { lines: { include: { ledgerAccount: true } } },
      });
      expect(entry.lines.map((l) => l.ledgerAccount.code).sort()).toEqual(["1000", "2200"]);
    });

    test("refused once payments have closed, the day before Eid", async () => {
      fitrToday = "2001-01-20";
      await expect(service.initiate({ ...base, kind: "fitr", fitrPeople: 1, fitrForm: "food" })).rejects.toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: "FITR_CLOSED" }) }),
      );
    });

    test("needs the number of people and the form", async () => {
      await expect(service.initiate({ ...base, kind: "fitr", fitrForm: "food" })).rejects.toThrow(BadRequestException);
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

  // Owner's decisions, 2026-11-16: the payer chooses a gold or silver
  // nisab where the ruleset allows it (silver to start), and the basis the
  // figure used is recorded with the payment and any monthly gift.
  describe("the nisab basis", () => {
    let choosingKey: string;
    let fixedKey: string;
    let lowerOfKey: string;

    beforeAll(async () => {
      const officer = await prisma.user.create({ data: { email: email("nisab-officer"), fullName: "Nisab Officer" } });
      const shariah = await prisma.user.create({ data: { email: email("nisab-shariah"), fullName: "Nisab Shariah" } });
      const approval = async () => {
        const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "zakah.ruleset_approve" } });
        return prisma.governedAction.create({
          data: { permissionId: permission.id, makerType: "human", makerUserId: officer.id, checkerUserId: shariah.id, status: "approved", decidedAt: new Date(), payload: {} },
        });
      };
      const shared = { personalJewellery: "exempt", debts: "deduct", nisabGoldGrams: "85", nisabSilverGrams: "595" };
      choosingKey = `test-${run}-nisab-choose`;
      fixedKey = `test-${run}-nisab-fixed`;
      lowerOfKey = `test-${run}-nisab-lower`;
      for (const [key, rulings] of [
        [choosingKey, { ...shared, nisabBasis: "gold", payerChoosesNisab: true }],
        [fixedKey, { ...shared, nisabBasis: "gold" }],
        [lowerOfKey, { ...shared, nisabBasis: "lower_of" }],
      ] as const) {
        await prisma.zakahRuleset.create({
          data: { key, madhhab: "maliki", version: 1, label: "Maliki", status: "approved", approvedAt: new Date(), approvedGovernedActionId: (await approval()).id, createdByUserId: officer.id, rulings },
        });
      }
    });

    afterAll(async () => {
      await prisma.zakahRuleset.updateMany({ where: { key: { in: [choosingKey, fixedKey, lowerOfKey] }, status: "approved" }, data: { status: "superseded" } });
    });

    const pay = (rulesetKey: string, extra: Record<string, unknown> = {}) =>
      service.initiate({ ...base, payerEmail: email(`nisab-${rulesetKey}`), rulesetKey, rulesetVersion: 1, ...extra } as never);
    const basisOf = async (id: string) => (await prisma.zakahPayment.findUniqueOrThrow({ where: { id } })).nisabBasis;

    test("where the payer may choose: their choice is recorded, and silver when they didn't say", async () => {
      expect(await basisOf((await pay(choosingKey, { nisabBasis: "gold" })).payment.id)).toBe("gold");
      expect(await basisOf((await pay(choosingKey)).payment.id)).toBe("silver");
    });

    test("where the ruleset fixes it: the ruleset's basis is recorded, and a choice is refused", async () => {
      expect(await basisOf((await pay(fixedKey)).payment.id)).toBe("gold");
      await expect(pay(fixedKey, { nisabBasis: "silver" })).rejects.toThrow(/sets the nisab itself/);
    });

    // Review finding (2026-11-16): "lower of" is a rule, not a metal; the
    // payment records the metal it came to with that day's prices.
    test("a ruleset using the lower of the two records the metal that was lower", async () => {
      const { payment } = await pay(lowerOfKey);
      const row = await prisma.zakahPayment.findUniqueOrThrow({ where: { id: payment.id }, include: { metalPrice: true } });
      const silver = row.metalPrice!.silverPerGram.times(595);
      const gold = row.metalPrice!.goldPerGram.times(85);
      expect(row.nisabBasis).toBe(silver.lte(gold) ? "silver" : "gold");
    });

    test("a monthly gift keeps the basis its setup used", async () => {
      const { payment } = await pay(choosingKey, { nisabBasis: "gold", monthly: true });
      const row = await prisma.zakahPayment.findUniqueOrThrow({ where: { id: payment.id } });
      expect((await prisma.recurringGift.findUniqueOrThrow({ where: { id: row.recurringGiftId! } })).zakahNisabBasis).toBe("gold");
    });

    test("without a ruleset (an amount typed by hand) nothing is recorded", async () => {
      expect(await basisOf((await service.initiate({ ...base })).payment.id)).toBeNull();
    });
  });

  // Owner's decisions, 2026-11-16: a confirmed WhatsApp number instead of
  // (or as well as) an email, and it adds up toward the AML threshold.
  describe("paying with a WhatsApp number", () => {
    const giver = createGiverWhatsApp();
    const recurringCore = createFakeRecurringGiftsCore().core;
    const withWhatsApp = new ZakahPaymentsService(
      encryption,
      settings,
      paystack as unknown as PaystackAdapter,
      new ZakahLedgerService(),
      receipts as unknown as ResendZakahReceiptEmailAdapter,
      fitr,
      recurringCore,
      giver.service,
      giver.fake as unknown as TwilioWhatsAppAdapter,
    );
    let threshold: Prisma.Decimal;

    beforeAll(async () => {
      threshold = (await prisma.vaultDonorThreshold.findUniqueOrThrow({ where: { currency: "NGN" } })).thresholdAmount;
    });

    test("a confirmed number alone is enough: the payer has no email, Paystack gets none, and the receipt comes by WhatsApp", async () => {
      const { number, proof } = await giver.confirmed();
      const { payment } = await withWhatsApp.initiate({ ...base, payerWhatsApp: number, whatsappProof: proof });
      const payer = await prisma.zakahPayer.findFirstOrThrow({ where: { whatsappNumber: number } });
      expect(payer.email).toBeNull();
      expect(paystack.created.at(-1)).toMatchObject({ reference: payment.id, payerEmail: undefined });

      paystack.nextWebhook = { providerReference: payment.id, status: "confirmed", providerPaymentId: "ps-wa" };
      await withWhatsApp.handleWebhook("paystack", Buffer.from("{}"), {});
      await new Promise((r) => setImmediate(r));
      const receipt = giver.fake.messages.find((m) => m.to === number);
      expect(receipt?.body).toContain("₦95,000.00 of zakah");
      expect(receipt?.body).toContain(payment.id);
      // Sent through the zakah receipt template, once one is approved.
      expect(giver.fake.templates.find((t) => t.to === number)).toEqual({
        to: number, template: "zakah_receipt", values: ["₦95,000.00 of zakah", payment.id],
      });
    });

    test("a number that hasn't been confirmed is refused", async () => {
      await expect(withWhatsApp.initiate({ ...base, payerWhatsApp: "0803 000 0000" })).rejects.toThrow(/Confirm your WhatsApp number/);
      await expect(withWhatsApp.initiate({ ...base, payerWhatsApp: "0803 000 0000", whatsappProof: "made-up" })).rejects.toThrow(/expired/);
    });

    test("two different emails sharing a confirmed number count together toward the threshold", async () => {
      const { number, proof } = await giver.confirmed();
      await withWhatsApp.initiate({ ...base, amount: threshold.times(0.6).toFixed(2), payerEmail: email("wa-first"), payerWhatsApp: number, whatsappProof: proof });
      // A different email, the same number: 0.6 + 0.5 of the threshold.
      await expect(
        withWhatsApp.initiate({ ...base, amount: threshold.times(0.5).toFixed(2), payerEmail: email("wa-second"), payerWhatsApp: number, whatsappProof: proof }),
      ).rejects.toThrow(expect.objectContaining({ response: expect.objectContaining({ code: "IDENTITY_REQUIRED" }) }));
      // Under the second email alone it would have passed.
      await expect(withWhatsApp.initiate({ ...base, amount: threshold.times(0.5).toFixed(2), payerEmail: email("wa-second") })).resolves.toBeDefined();
    });

    // Review finding (2026-11-16): anyone can type an email, so typing
    // someone else's beside your own number must never route their receipts to you.
    test("someone typing another payer's email beside their own number gets neither that payer's record nor their receipts", async () => {
      const victimEmail = email("wa-victim");
      const own = await withWhatsApp.initiate({ ...base, payerEmail: victimEmail });
      const attacker = await giver.confirmed();
      const theirs = await withWhatsApp.initiate({ ...base, payerEmail: victimEmail, payerWhatsApp: attacker.number, whatsappProof: attacker.proof });

      const victim = await prisma.zakahPayer.findFirstOrThrow({ where: { email: victimEmail } });
      expect(victim.whatsappNumber).toBeNull();
      expect(await prisma.zakahPayment.findUniqueOrThrow({ where: { id: theirs.payment.id } })).toMatchObject({
        payerId: victim.id, contactEmail: victimEmail, contactWhatsApp: attacker.number,
      });

      const before = giver.fake.messages.filter((m) => m.to === attacker.number).length;
      paystack.nextWebhook = { providerReference: own.payment.id, status: "confirmed", providerPaymentId: `ps-own-${run}` };
      await withWhatsApp.handleWebhook("paystack", Buffer.from("{}"), {});
      await new Promise((r) => setImmediate(r));
      expect(receipts.sent.some((r) => r.paymentId === own.payment.id && r.to === victimEmail)).toBe(true);
      expect(giver.fake.messages.filter((m) => m.to === attacker.number)).toHaveLength(before);
    });

    test("monthly zakah with only a number: the gift has no email and Paystack saves the card under its stand-in", async () => {
      const { number, proof } = await giver.confirmed();
      const { payment } = await withWhatsApp.initiate({ ...base, monthly: true, payerWhatsApp: number, whatsappProof: proof });
      const row = await prisma.zakahPayment.findUniqueOrThrow({ where: { id: payment.id } });
      const gift = await prisma.recurringGift.findUniqueOrThrow({ where: { id: row.recurringGiftId! } });
      expect(gift).toMatchObject({ email: null, whatsappNumber: number });
      expect(paystack.created.at(-1)).toMatchObject({ payerEmail: `giver+${gift.id}@example.com`, cardOnly: true });
      // Without an email or a number it's refused.
      await expect(withWhatsApp.initiate({ ...base, monthly: true })).rejects.toThrow(/email or WhatsApp number/);
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

    test("the zakah bank account holds exactly what's held for recipients across all three pools", async () => {
      const balances = await service.ledgerBalances();
      const bank = balances.find((b) => b.code === "1000")!;
      const held = balances.filter((b) => ["2000", "2100", "2200"].includes(b.code));
      expect(held).toHaveLength(3);
      const totalHeld = held.reduce((sum, b) => sum.plus(b.balance), new Prisma.Decimal(0));
      expect(totalHeld.toFixed(2)).toBe(bank.balance);
      expect(Number(bank.balance)).toBeGreaterThan(0);
    });
  });
});

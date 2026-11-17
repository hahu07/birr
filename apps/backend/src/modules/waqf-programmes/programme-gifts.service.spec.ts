import { prisma, Prisma } from "@birr/db";
import { BadRequestException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { processingFeeCover } from "@birr/zakah";
import { EncryptionService } from "../../common/settings/encryption.service";
import type { SettingsService } from "../../common/settings/settings.service";
import type { PaystackAdapter } from "../contributions/providers/paystack.adapter";
import type { CreatePaymentInput, VerifiedPayment, WebhookResult } from "../contributions/providers/payment-provider.interface";
import { VaultContributionsService } from "../vaults/vault-contributions.service";
import { VaultLedgerService } from "../vaults/vault-ledger.service";
import { FunnelEventsService } from "../funnel-events/funnel-events.service";
import { createFakeRecurringGiftsCore } from "../recurring-gifts/test-support/fake-recurring-gifts";
import { ProgrammeGiftsService, CLINIC_FOUNDER_FIRST_GIFT_MINIMUM_NGN, CLINIC_PUBLIC_MINIMUM_NGN } from "./programme-gifts.service";
import { FoundersService } from "../founders/founders.service";
import { MfaService } from "../../common/auth/mfa.service";
import { ProgrammeLedgerService } from "./programme-ledger.service";
import { WaqfProgrammesService } from "./waqf-programmes.service";
import type { ProgrammeGiftReceipt, ResendProgrammeReceiptEmailAdapter } from "./programme-receipt-email.adapter";

// A fake Paystack: records what would be sent, and lets each test decide
// what the webhook or verify call reports. Nothing reaches Paystack.
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
  sent: ProgrammeGiftReceipt[] = [];
  async sendReceipt(input: ProgrammeGiftReceipt) {
    this.sent.push(input);
  }
}

const unusedAdapter = {} as any;

// Gifts, clinic waqfs and their ledgers are never deleted (triggers), so
// these fixtures stay in the dev database, identifiable by per-run emails.
describe("ProgrammeGiftsService", () => {
  const run = Date.now().toString(36);
  let subaccount: string | undefined = "ACCT_test_clinic";
  const settings = {
    get: async (provider: string, key: string) => (provider === "paystack" && key === "CLINIC_WAQF_SUBACCOUNT_CODE" ? subaccount : undefined),
  } as unknown as SettingsService;
  const paystack = new FakePaystack();
  const receipts = new FakeReceipts();
  const encryption = new EncryptionService();
  const vaultContributions = new VaultContributionsService(
    encryption,
    unusedAdapter,
    new VaultLedgerService(),
    new FunnelEventsService(),
    createFakeRecurringGiftsCore().core,
    unusedAdapter,
    unusedAdapter,
    unusedAdapter,
  );
  const service = new ProgrammeGiftsService(
    settings,
    paystack as unknown as PaystackAdapter,
    new ProgrammeLedgerService(),
    receipts as unknown as ResendProgrammeReceiptEmailAdapter,
    vaultContributions,
    createFakeRecurringGiftsCore().core,
  );
  const clinics = new WaqfProgrammesService();
  const email = (name: string) => `clinic-gift-${name}-${run}@example.com`;

  let makerUserId: string;
  let checkerUserId: string;
  let clinic: { id: string; slug: string };
  let deed: { id: string; textHash: string };

  async function staff(role: "mutawalli_officer" | "board_of_trustees", label: string) {
    const user = await prisma.user.create({ data: { email: `clinic-gifts-${label}-${randomUUID()}@example.com`, fullName: `Clinic ${label}` } });
    await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role } } } });
    return user.id;
  }

  // A decided governed action to hang an approval on: the engine itself is
  // covered by governed-actions.service.spec.ts.
  async function decidedAction(key: string, payload: object) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
    return prisma.governedAction.create({
      data: { permissionId: permission.id, makerType: "human", makerUserId, checkerUserId, status: "approved", decidedAt: new Date(), payload },
    });
  }

  async function establishedClinic() {
    const created = await clinics.create({ name: "Gift Test Clinic", slug: `gift-clinic-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" }, makerUserId);
    const draft = await clinics.draftDeed(created.id, {}, makerUserId);
    const deedPayload = { deedId: draft.id, textHash: draft.textHash };
    const deedAction = await decidedAction("waqf_programme.deed_approve", deedPayload);
    await prisma.$transaction((tx) => clinics.approveDeed(deedPayload, deedAction.id, checkerUserId, tx));
    const establishAction = await decidedAction("waqf_programme.establish", { programmeId: created.id });
    await prisma.$transaction((tx) => clinics.establish({ programmeId: created.id }, establishAction.id, tx));
    return { clinic: created, deed: draft };
  }

  const endowment = () => ({ slug: clinic.slug, pot: "endowment" as const, amount: "10000", coverFee: false, deedId: deed.id, deedTextHash: deed.textHash });
  const running = () => ({ slug: clinic.slug, pot: "running" as const, amount: "7500", coverFee: false });

  async function confirmViaWebhook(giftId: string) {
    paystack.nextWebhook = { providerReference: giftId, status: "confirmed", providerPaymentId: "ps-1" };
    return service.handleWebhook("paystack", Buffer.from("{}"), {});
  }

  beforeAll(async () => {
    makerUserId = await staff("mutawalli_officer", "maker");
    checkerUserId = await staff("board_of_trustees", "checker");
    ({ clinic, deed } = await establishedClinic());
  });

  beforeEach(() => {
    subaccount = "ACCT_test_clinic";
    paystack.nextWebhook = null;
    paystack.nextVerify = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("before giving opens", () => {
    test("terms say it isn't open until the subaccount is set, and give the approved deed", async () => {
      subaccount = undefined;
      const closed = await service.givingTerms(clinic.slug);
      expect(closed).toMatchObject({ available: false, minimumAmount: CLINIC_PUBLIC_MINIMUM_NGN, deed: { id: deed.id, textHash: deed.textHash } });
      subaccount = "ACCT_test_clinic";
      expect((await service.givingTerms(clinic.slug)).available).toBe(true);
    });

    test("no gift is taken without the clinic waqf's own subaccount, or by a clinic that isn't established", async () => {
      subaccount = undefined;
      await expect(service.initiate(running())).rejects.toThrow(ServiceUnavailableException);
      subaccount = "ACCT_test_clinic";
      const draft = await clinics.create({ name: "Draft Clinic", slug: `gift-draft-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" }, makerUserId);
      await expect(service.initiate({ ...running(), slug: draft.slug })).rejects.toThrow(/isn't taking gifts/);
      await expect(service.initiate({ ...running(), slug: "no-such-clinic" })).rejects.toThrow(NotFoundException);
    });
  });

  describe("starting a gift", () => {
    test("refuses less than the minimum", async () => {
      await expect(service.initiate({ ...running(), amount: "4999" })).rejects.toThrow(BadRequestException);
    });

    test("an endowment gift must accept the approved deed, word for word", async () => {
      await expect(service.initiate({ ...endowment(), deedId: undefined, deedTextHash: undefined })).rejects.toThrow(/deed has changed/);
      await expect(service.initiate({ ...endowment(), deedTextHash: "0".repeat(64) })).rejects.toThrow(/deed has changed/);
    });

    test("settles into the clinic subaccount; a covered fee goes to Birr's main account; the deed accepted is recorded", async () => {
      const { gift } = await service.initiate({ ...endowment(), coverFee: true, donorEmail: email("endow") });
      const fee = processingFeeCover("10000.00");
      expect(gift).toMatchObject({ pot: "endowment", amount: "10000.00", feeCover: Number(fee).toFixed(2), status: "pending" });
      expect(paystack.created.at(-1)).toMatchObject({
        amount: new Prisma.Decimal(10000).plus(fee).toFixed(2),
        reference: gift.id,
        returnPath: "clinic-gifts",
        split: { subaccount: "ACCT_test_clinic", mainAccountShareMinorUnits: Math.round(Number(fee) * 100) },
      });
      const row = await prisma.programmeGift.findUniqueOrThrow({ where: { id: gift.id } });
      expect(row).toMatchObject({ settlementSubaccount: "ACCT_test_clinic", deedId: deed.id, deedTextHash: deed.textHash, contactEmail: email("endow") });
      expect(row.donorId).not.toBeNull();
      expect(await prisma.auditLog.count({ where: { entityId: gift.id, action: "programme_gift.initiated" } })).toBe(1);
    });
  });

  describe("confirming a gift", () => {
    test("an endowment gift is booked to the endowment only, once, with a receipt", async () => {
      const { gift } = await service.initiate({ ...endowment(), donorEmail: email("confirm-endow") });
      await confirmViaWebhook(gift.id);
      await confirmViaWebhook(gift.id); // a retried webhook

      expect((await prisma.programmeGift.findUniqueOrThrow({ where: { id: gift.id } })).status).toBe("confirmed");
      const entries = await prisma.programmeJournalEntry.findMany({ where: { source: "gift", sourceId: gift.id }, include: { lines: { include: { ledgerAccount: true } } } });
      expect(entries).toHaveLength(1);
      expect(entries[0].lines.map((l) => [l.ledgerAccount.code, l.debit.toFixed(2), l.credit.toFixed(2)]).sort()).toEqual([
        ["1000", "10000.00", "0.00"],
        ["3000", "0.00", "10000.00"],
      ]);
      expect(await prisma.auditLog.count({ where: { entityId: gift.id, action: "programme_gift.confirmed" } })).toBe(1);
      expect(receipts.sent.filter((r) => r.giftId === gift.id)).toEqual([
        expect.objectContaining({ to: email("confirm-endow"), pot: "endowment", amount: "10000.00", deedVersion: 1 }),
      ]);
    });

    test("a running-fund gift is booked to the running fund", async () => {
      const { gift } = await service.initiate({ ...running() });
      await confirmViaWebhook(gift.id);
      const [entry] = await prisma.programmeJournalEntry.findMany({ where: { source: "gift", sourceId: gift.id }, include: { lines: { include: { ledgerAccount: true } } } });
      expect(entry.lines.map((l) => l.ledgerAccount.code).sort()).toEqual(["1100", "4000"]);
      expect(receipts.sent.some((r) => r.giftId === gift.id)).toBe(false); // no contact given, no receipt
    });

    test("the giver's return confirms only when Paystack charged exactly the gift plus fee", async () => {
      const { gift } = await service.initiate({ ...running(), coverFee: true });
      const expected = Math.round((7500 + Number(processingFeeCover("7500.00"))) * 100);
      paystack.nextVerify = { status: "confirmed", amountMinorUnits: expected - 100, currency: "NGN", providerPaymentId: "ps-2" };
      expect((await service.reconcile(gift.id))?.status).toBe("pending");
      (service as any).lastVerifiedAt.clear();
      paystack.nextVerify = { status: "confirmed", amountMinorUnits: expected, currency: "NGN", providerPaymentId: "ps-2" };
      expect((await service.reconcile(gift.id))?.status).toBe("confirmed");
    });

    test("a webhook for a reference that isn't a clinic gift is left for the next product", async () => {
      paystack.nextWebhook = { providerReference: randomUUID(), status: "confirmed" };
      expect(await service.handleWebhook("paystack", Buffer.from("{}"), {})).toBeNull();
    });
  });

  describe("the AML ID threshold counts Vault and clinic giving together", () => {
    test("a clinic gift that takes the giver's Vault and clinic total past the threshold needs their ID", async () => {
      const threshold = await prisma.vaultDonorThreshold.findUnique({ where: { currency: "NGN" } });
      if (!threshold || threshold.thresholdAmount.lte(0)) return; // no NGN threshold configured in this database
      const giver = email("aml");
      const donor = await prisma.vaultDonor.create({ data: { email: giver } });
      // Its own Vault: a fresh database (CI) has none.
      const vault = await prisma.vault.create({
        data: { name: "Clinic AML Fixture Vault", slug: `clinic-aml-${randomUUID().slice(0, 8)}`, type: "project", currency: "NGN", jurisdiction: "NG", createdByUserId: makerUserId },
      });
      const nearly = threshold.thresholdAmount.minus(1000);
      await prisma.vaultContribution.create({
        data: { vaultId: vault.id, donorId: donor.id, amount: nearly, currency: "NGN", provider: "paystack", providerReference: randomUUID(), status: "confirmed", confirmedAt: new Date() },
      });
      await expect(service.initiate({ ...running(), amount: "5000", donorEmail: giver })).rejects.toThrow(/confirm your identity/);
      const { gift } = await service.initiate({ ...running(), amount: "5000", donorEmail: giver, donorFullName: "Amina Bello", idType: "national_id", idNumber: "12345678901" });
      expect(gift.status).toBe("pending");
    });
  });

  // Slice 4a: a Founder who joined from the clinic page, without a Foundation.
  describe("Founders", () => {
    const founders = new FoundersService(undefined as never, undefined as never, encryption, new MfaService(), new FunnelEventsService());

    async function verifiedUser(label: string, verified = true) {
      return prisma.user.create({
        data: {
          email: email(`founder-${label}`),
          fullName: `Founder ${label}`,
          status: verified ? "active" : "invited",
          whatsappNumber: "+2348030000000",
          whatsappVerifiedAt: verified ? new Date() : null,
        },
      });
    }

    test("a verified user becomes a clinic supporter: a Founder with no Foundation, onboarding done, audited", async () => {
      const user = await verifiedUser("supporter");
      const founder = await founders.establishClinicSupporter(user.id, { founderName: "Amina Bello", kind: "individual" });
      expect(founder).toMatchObject({ programmeSupporter: true, kind: "individual" });
      expect(await prisma.auditLog.count({ where: { entityId: founder.id, action: "founder.created" } })).toBe(1);
      const status = await founders.getOnboardingStatus(user.id);
      expect(status).toMatchObject({ founderId: founder.id, currentStep: "done", onboardingComplete: true, clinicSupporterOnly: true });
      await expect(founders.establishClinicSupporter(user.id, { founderName: "Again", kind: "individual" })).rejects.toThrow(/already part of a Founder/);
    });

    test("not before email and WhatsApp are verified; an institution says what kind it is", async () => {
      const unverified = await verifiedUser("unverified", false);
      await expect(founders.establishClinicSupporter(unverified.id, { founderName: "Not Yet", kind: "individual" })).rejects.toThrow();
      const user = await verifiedUser("institution");
      await expect(founders.establishClinicSupporter(user.id, { founderName: "Fixture Bank", kind: "institution" })).rejects.toThrow(/kind of institution/);
    });

    test("a Founder's first gift is at least ₦250,000, later ones ₦5,000; recorded as theirs, receipt to their account", async () => {
      const user = await verifiedUser("giver");
      const founder = await founders.establishClinicSupporter(user.id, { founderName: "Giving Founder", kind: "individual" });
      expect((await service.founderGivingTerms(founder.id, clinic.slug)).minimumAmount).toBe(CLINIC_FOUNDER_FIRST_GIFT_MINIMUM_NGN);
      await expect(service.initiateAsFounder(founder.id, user.id, { ...running(), amount: "249999" })).rejects.toThrow(/at least ₦250,000/);

      const { gift } = await service.initiateAsFounder(founder.id, user.id, { ...endowment(), amount: "250000" });
      const row = await prisma.programmeGift.findUniqueOrThrow({ where: { id: gift.id } });
      expect(row).toMatchObject({ founderId: founder.id, initiatedByUserId: user.id, donorId: null, contactEmail: user.email, contactWhatsApp: "+2348030000000" });
      const [log] = await prisma.auditLog.findMany({ where: { entityId: gift.id, action: "programme_gift.initiated" } });
      expect(log).toMatchObject({ actorType: "founder_user", actorUserId: user.id, actorFounderId: founder.id });

      await confirmViaWebhook(gift.id);
      expect((await service.founderGivingTerms(founder.id, clinic.slug)).minimumAmount).toBe(CLINIC_PUBLIC_MINIMUM_NGN);
      await service.initiateAsFounder(founder.id, user.id, { ...running(), amount: "5000" });

      const mine = await service.listForFounder(founder.id);
      expect(mine.clinics).toEqual([{ clinic: expect.objectContaining({ slug: clinic.slug }), endowment: "250000.00", running: "0.00" }]);
      expect(mine.gifts).toHaveLength(2);
    });

    test("an unverified Founder can't give", async () => {
      const user = await verifiedUser("lapsed");
      const founder = await founders.establishClinicSupporter(user.id, { founderName: "Lapsed Founder", kind: "individual" });
      await prisma.user.update({ where: { id: user.id }, data: { whatsappVerifiedAt: null } });
      await expect(service.initiateAsFounder(founder.id, user.id, { ...running(), amount: "250000" })).rejects.toThrow(/WhatsApp/);
    });

    test("the database refuses a gift that is both a Founder's and a public giver's", async () => {
      const user = await verifiedUser("both");
      const founder = await founders.establishClinicSupporter(user.id, { founderName: "Both Founder", kind: "individual" });
      const donor = await prisma.vaultDonor.create({ data: { email: email("both-donor") } });
      await expect(
        prisma.programmeGift.create({
          data: { programmeId: clinic.id, pot: "running", amount: 5000, currency: "NGN", provider: "paystack", providerReference: randomUUID(), settlementSubaccount: "ACCT_x", founderId: founder.id, initiatedByUserId: user.id, donorId: donor.id },
        }),
      ).rejects.toThrow(/programme_gifts_one_giver/);
    });
  });

  describe("the AML review", () => {
    test("lists public clinic gifts near the threshold alongside Vault gifts, under the clinic's name", async () => {
      const threshold = await prisma.vaultDonorThreshold.findUnique({ where: { currency: "NGN" } });
      if (!threshold || threshold.thresholdAmount.lte(0)) return;
      const near = threshold.thresholdAmount.times(0.9).toFixed(2);
      const ids: string[] = [];
      for (const n of [1, 2]) {
        const { gift } = await service.initiate({ ...running(), amount: near, donorEmail: email(`near-${n}`), donorFullName: "Near Giver", idType: "national_id", idNumber: `9000000000${n}` });
        await confirmViaWebhook(gift.id);
        ids.push(gift.id);
      }
      const { groups } = await vaultContributions.getStructuringReview();
      const group = groups.find((g) => g.vaultId === clinic.id);
      expect(group).toMatchObject({ vaultName: "Gift Test Clinic (clinic waqf)", currency: "NGN" });
      expect(group!.contributions.map((c) => c.id)).toEqual(expect.arrayContaining(ids));
    });
  });

  describe("the database", () => {
    test("refuses an endowment gift under a deed that isn't the approved one, as worded", async () => {
      await expect(
        prisma.programmeGift.create({
          data: {
            programmeId: clinic.id,
            pot: "endowment",
            amount: 10000,
            currency: "NGN",
            provider: "paystack",
            providerReference: randomUUID(),
            settlementSubaccount: "ACCT_x",
            deedId: deed.id,
            deedTextHash: "f".repeat(64),
          },
        }),
      ).rejects.toThrow(/approved deed/);
      await expect(
        prisma.programmeGift.create({
          data: { programmeId: clinic.id, pot: "running", amount: 10000, currency: "NGN", provider: "paystack", providerReference: randomUUID(), settlementSubaccount: "ACCT_x", deedId: deed.id, deedTextHash: deed.textHash },
        }),
      ).rejects.toThrow(/programme_gifts_deed_matches_pot/);
    });

    test("refuses changing what was given, settling a gift twice, or deleting one", async () => {
      const { gift } = await service.initiate({ ...running() });
      await expect(prisma.programmeGift.update({ where: { id: gift.id }, data: { amount: 1 } })).rejects.toThrow(/never change/);
      await expect(prisma.programmeGift.update({ where: { id: gift.id }, data: { pot: "endowment" } })).rejects.toThrow();
      await confirmViaWebhook(gift.id);
      await expect(prisma.programmeGift.update({ where: { id: gift.id }, data: { status: "failed", confirmedAt: null } })).rejects.toThrow(/can't change/);
      await expect(prisma.programmeGift.delete({ where: { id: gift.id } })).rejects.toThrow(/never deleted/);
    });
  });
});

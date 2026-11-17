import { prisma, type RecurringGift } from "@birr/db";
import { randomUUID } from "crypto";
import { EncryptionService } from "../../common/settings/encryption.service";
import type { SettingsService } from "../../common/settings/settings.service";
import { MfaService } from "../../common/auth/mfa.service";
import { VaultContributionsService } from "../vaults/vault-contributions.service";
import { VaultLedgerService } from "../vaults/vault-ledger.service";
import { FunnelEventsService } from "../funnel-events/funnel-events.service";
import { FoundersService } from "../founders/founders.service";
import { ProgrammeGiftsService } from "../waqf-programmes/programme-gifts.service";
import { ProgrammeLedgerService } from "../waqf-programmes/programme-ledger.service";
import { WaqfProgrammesService } from "../waqf-programmes/waqf-programmes.service";
import { ProgrammeMonthlyProduct } from "./programme-monthly.product";
import { RecurringGiftsService } from "./recurring-gifts.service";
import { VaultMonthlyProduct } from "./vault-monthly.product";
import { WaqfMonthlyProduct } from "./waqf-monthly.product";
import { ZakahMonthlyProduct } from "./zakah-monthly.product";
import { createFakeRecurringGiftsCore, FakeRecurringPaystack, REUSABLE_CARD } from "./test-support/fake-recurring-gifts";

// Monthly gifts to a clinic waqf (2026-11-17, clinic slice 4b), through the
// real flow with a fake Paystack. Clinic gifts, deeds and their monthly
// gifts are never deleted (triggers and RESTRICT keys), so these fixtures
// stay in the dev database, named by run.
describe("Monthly clinic waqf gifts", () => {
  const run = Date.now().toString(36);
  const paystack = new FakeRecurringPaystack();
  const { core, emails } = createFakeRecurringGiftsCore(paystack);
  const settings = {
    get: async (provider: string, key: string) => (provider === "paystack" && key === "CLINIC_WAQF_SUBACCOUNT_CODE" ? "ACCT_test_clinic" : undefined),
  } as unknown as SettingsService;
  const unused = {} as any;
  const vaultContributions = new VaultContributionsService(
    new EncryptionService(),
    unused,
    new VaultLedgerService(),
    new FunnelEventsService(),
    core,
    unused,
    unused,
    unused,
  );
  const gifts = new ProgrammeGiftsService(settings, paystack as any, new ProgrammeLedgerService(), { sendReceipt: async () => undefined } as any, vaultContributions, core);
  const service = new RecurringGiftsService(
    core,
    new VaultMonthlyProduct(null as any),
    new WaqfMonthlyProduct(null as any),
    new ZakahMonthlyProduct(null as any),
    undefined,
    new ProgrammeMonthlyProduct(gifts, vaultContributions),
  );
  const clinics = new WaqfProgrammesService();
  const founders = new FoundersService(undefined as never, undefined as never, new EncryptionService(), new MfaService(), new FunnelEventsService());

  let makerUserId: string;
  let checkerUserId: string;
  let clinic: { id: string; slug: string };
  let deed: { id: string; textHash: string };
  let n = 0;
  const email = () => `clinic-monthly-${run}-${n++}@example.com`;

  async function staff(role: "mutawalli_officer" | "board_of_trustees") {
    const user = await prisma.user.create({ data: { email: `clinic-monthly-${role}-${randomUUID()}@example.com`, fullName: role } });
    await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role } } } });
    return user.id;
  }

  async function decidedAction(key: string, payload: object) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
    return prisma.governedAction.create({
      data: { permissionId: permission.id, makerType: "human", makerUserId, checkerUserId, status: "approved", decidedAt: new Date(), payload },
    });
  }

  async function approveDeed(programmeId: string, text?: string) {
    const draft = await clinics.draftDeed(programmeId, text ? { text } : {}, makerUserId);
    const payload = { deedId: draft.id, textHash: draft.textHash };
    const action = await decidedAction("waqf_programme.deed_approve", payload);
    await prisma.$transaction((tx) => clinics.approveDeed(payload, action.id, checkerUserId, tx));
    return draft;
  }

  async function waitFor<T>(read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 10_000;
    let value = await read();
    while (!ok(value) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      value = await read();
    }
    return value;
  }

  const reload = (gift: { id: string }) => prisma.recurringGift.findUniqueOrThrow({ where: { id: gift.id } });
  const due = (gift: RecurringGift) => prisma.recurringGift.update({ where: { id: gift.id }, data: { nextChargeAt: new Date(Date.now() - 60_000) } });

  /** Set up through the real flow: card checkout, then the confirmation that saves the card. */
  async function activePublicGift(pot: "endowment" | "running") {
    const giver = email();
    const result = await gifts.initiate({
      slug: clinic.slug,
      pot,
      amount: "10000",
      coverFee: false,
      donorEmail: giver,
      monthly: true,
      ...(pot === "endowment" && { deedId: deed.id, deedTextHash: deed.textHash }),
    });
    const row = await prisma.programmeGift.findUniqueOrThrow({ where: { id: result.gift.id } });
    await gifts.reconcile(row.id);
    const gift = await waitFor(() => reload({ id: row.recurringGiftId! }), (g) => g.status !== "pending_setup");
    return { gift, firstGiftId: row.id, giver };
  }

  beforeAll(async () => {
    makerUserId = await staff("mutawalli_officer");
    checkerUserId = await staff("board_of_trustees");
    const created = await clinics.create({ name: "Monthly Test Clinic", slug: `monthly-clinic-${run}`, city: "Ibadan", jurisdiction: "NG" }, makerUserId);
    deed = await approveDeed(created.id);
    const establish = await decidedAction("waqf_programme.establish", { programmeId: created.id });
    await prisma.$transaction((tx) => clinics.establish({ programmeId: created.id }, establish.id, tx));
    clinic = created;
  });

  beforeEach(() => {
    paystack.card = REUSABLE_CARD;
    paystack.nextCharge = { status: "confirmed", providerPaymentId: "pay_fake" };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("a public monthly endowment gift starts with a card-only checkout and keeps the deed accepted", async () => {
    const { gift, firstGiftId, giver } = await activePublicGift("endowment");
    expect(paystack.checkouts.find((c) => c.reference === firstGiftId)).toMatchObject({ cardOnly: true });
    expect(gift).toMatchObject({ kind: "programme", status: "active", programmeId: clinic.id, programmePot: "endowment", programmeDeedId: deed.id, founderId: null, cardLast4: "4081" });
    expect(gift.manageTokenHash).toMatch(/^[0-9a-f]{64}$/);
    const first = await prisma.programmeGift.findUniqueOrThrow({ where: { id: firstGiftId } });
    expect(first).toMatchObject({ status: "confirmed", recurringGiftId: gift.id });
    await waitFor(async () => emails.sent.some((e) => e.to === giver && e.subject === "Your monthly gift is set up"), Boolean);
    const mail = emails.sent.find((e) => e.to === giver && e.subject === "Your monthly gift is set up")!;
    expect(mail.bodyHtml).toContain("endowment of Monthly Test Clinic");
  });

  test("giving monthly needs an email or WhatsApp number", async () => {
    await expect(gifts.initiate({ slug: clinic.slug, pot: "running", amount: "10000", coverFee: false, monthly: true })).rejects.toThrow(/email or WhatsApp/);
  });

  test("a later month is charged to the saved card and booked to its pot, once", async () => {
    const { gift } = await activePublicGift("running");
    await due(gift);
    await service.processDue(gift.id);
    const charged = await waitFor(
      () => prisma.programmeGift.findMany({ where: { recurringGiftId: gift.id, recurringPeriod: gift.nextPeriod } }),
      (rows) => rows.some((r) => r.status === "confirmed"),
    );
    expect(charged).toHaveLength(1);
    expect(charged[0]).toMatchObject({ pot: "running", amount: expect.anything(), status: "confirmed" });
    const entries = await prisma.programmeJournalEntry.findMany({ where: { source: "gift", sourceId: charged[0].id }, include: { lines: { include: { ledgerAccount: true } } } });
    expect(entries[0].lines.map((l) => l.ledgerAccount.code).sort()).toEqual(["1100", "4000"]);
    expect((await reload(gift)).nextPeriod).not.toBe(gift.nextPeriod);
  });

  test("a new deed version pauses a monthly endowment gift until the giver accepts it", async () => {
    const separate = await clinics.create({ name: "Deed Change Clinic", slug: `deed-change-${run}`, city: "Ibadan", jurisdiction: "NG" }, makerUserId);
    const v1 = await approveDeed(separate.id, "Version one.");
    const establish = await decidedAction("waqf_programme.establish", { programmeId: separate.id });
    await prisma.$transaction((tx) => clinics.establish({ programmeId: separate.id }, establish.id, tx));
    const giver = email();
    const result = await gifts.initiate({ slug: separate.slug, pot: "endowment", amount: "10000", coverFee: false, donorEmail: giver, monthly: true, deedId: v1.id, deedTextHash: v1.textHash });
    const row = await prisma.programmeGift.findUniqueOrThrow({ where: { id: result.gift.id } });
    await gifts.reconcile(row.id);
    const gift = await waitFor(() => reload({ id: row.recurringGiftId! }), (g) => g.status === "active");

    const v2 = await approveDeed(separate.id, "Version two.");
    await due(gift);
    await service.processDue(gift.id);
    const paused = await waitFor(() => reload(gift), (g) => g.status === "paused");
    expect(paused.pauseReason).toBe("terms_changed");

    await waitFor(async () => emails.sent.some((e) => e.to === giver && e.subject === "Your monthly gift is set up"), Boolean);
    const token = emails.sent.find((e) => e.to === giver && e.subject === "Your monthly gift is set up")!.ctaUrl!.split("/giving/manage/")[1];
    const view = await service.view(token);
    expect(view.newDeed).toMatchObject({ id: v2.id, version: 2 });
    await expect(service.acceptProgrammeDeed(token, { deedId: v1.id, textHash: v1.textHash })).rejects.toThrow(/changed again/);
    const resumed = await service.acceptProgrammeDeed(token, { deedId: v2.id, textHash: v2.textHash });
    expect(resumed.status).toBe("active");
    expect(await reload(gift)).toMatchObject({ programmeDeedId: v2.id, programmeDeedTextHash: v2.textHash });
  });

  test("a Founder's monthly gift is theirs: no private link, listed and cancelled in their portal", async () => {
    const user = await prisma.user.create({
      data: { email: email(), fullName: "Monthly Founder", status: "active", whatsappNumber: "+2348030000001", whatsappVerifiedAt: new Date() },
    });
    const founder = await founders.establishClinicSupporter(user.id, { founderName: "Monthly Founder", kind: "individual" });
    await expect(
      gifts.initiateAsFounder(founder.id, user.id, { slug: clinic.slug, pot: "running", amount: "10000", coverFee: false, monthly: true }),
    ).rejects.toThrow(/at least ₦250,000/);

    const result = await gifts.initiateAsFounder(founder.id, user.id, { slug: clinic.slug, pot: "running", amount: "250000", coverFee: false, monthly: true });
    const row = await prisma.programmeGift.findUniqueOrThrow({ where: { id: result.gift.id } });
    await gifts.reconcile(row.id);
    const gift = await waitFor(() => reload({ id: row.recurringGiftId! }), (g) => g.status === "active");
    expect(gift).toMatchObject({ founderId: founder.id, email: user.email, manageTokenHash: null });

    // A later month is given by the Founder's primary contact, with no one signed in.
    await due(gift);
    await service.processDue(gift.id);
    const later = await waitFor(
      () => prisma.programmeGift.findFirst({ where: { recurringGiftId: gift.id, recurringPeriod: gift.nextPeriod } }),
      (r) => r?.status === "confirmed",
    );
    expect(later).toMatchObject({ founderId: founder.id, initiatedByUserId: user.id, donorId: null });

    const listed = await service.founderProgrammeGifts(founder.id);
    expect(listed.map((g) => g.id)).toEqual([gift.id]);
    expect((await service.founderClinicCancel(gift.id, founder.id)).status).toBe("cancelled");
    await expect(service.founderClinicCancel(gift.id, randomUUID())).rejects.toThrow(/not found/);
  });

  test("the database refuses a monthly clinic endowment gift without the deed accepted", async () => {
    await expect(
      prisma.recurringGift.create({
        data: { kind: "programme", email: email(), amount: 10000, dayOfMonth: 1, nextPeriod: "2026-12", programmeId: clinic.id, programmePot: "endowment" },
      }),
    ).rejects.toThrow(/recurring_gifts_clinic_fields/);
  });
});

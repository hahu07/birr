import { BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma, Prisma, type RecurringGift } from "@birr/db";
import { EncryptionService } from "../../common/settings/encryption.service";
import { VaultContributionsService } from "../vaults/vault-contributions.service";
import { VaultsService } from "../vaults/vaults.service";
import { VaultProceedsService } from "../vaults/vault-proceeds.service";
import { VaultLedgerService } from "../vaults/vault-ledger.service";
import { FunnelEventsService } from "../funnel-events/funnel-events.service";
import { RecurringGiftsService } from "./recurring-gifts.service";
import { VaultMonthlyProduct } from "./vault-monthly.product";
import { WaqfMonthlyProduct } from "./waqf-monthly.product";
import { ZakahMonthlyProduct } from "./zakah-monthly.product";
import { ZakahPaymentsService } from "../zakah/zakah-payments.service";
import { ZakahLedgerService } from "../zakah/zakah-ledger.service";
import { ZakahFitrService } from "../zakah/zakah-fitr.service";
import { ZAKAH_WAKALAH_TERMS } from "../zakah/zakah-terms";
import { ContributionsService } from "../contributions/contributions.service";
import { AssetsService } from "../assets/assets.service";
import { WaqfLedgerService } from "../waqf-ledger/waqf-ledger.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import { addMonths, cardExpiredBy, chargeDateFor, dayOfMonthFor, periodOf } from "./recurring-gift-dates";
import { createFakeRecurringGiftsCore, FakeRecurringPaystack, REUSABLE_CARD } from "./test-support/fake-recurring-gifts";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("recurring-gift dates (Lagos time)", () => {
  test("a month is the month in Lagos, an hour ahead of UTC", () => {
    expect(periodOf(new Date("2026-11-30T22:59:00Z"))).toBe("2026-11");
    expect(periodOf(new Date("2026-11-30T23:00:00Z"))).toBe("2026-12");
  });
  test("months roll over the year", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  test("a gift started on the 31st repeats on the 28th, so every month has its day", () => {
    expect(dayOfMonthFor(new Date("2026-12-31T10:00:00Z"))).toBe(28);
    expect(dayOfMonthFor(new Date("2026-12-14T10:00:00Z"))).toBe(14);
  });
  test("a charge is due at 09:00 Lagos on its day", () => {
    expect(chargeDateFor("2027-02", 28).toISOString()).toBe("2027-02-28T08:00:00.000Z");
  });
  test("a card is valid through the end of its expiry month", () => {
    expect(cardExpiredBy(11, 2026, new Date("2026-11-30T12:00:00Z"))).toBe(false);
    expect(cardExpiredBy(11, 2026, new Date("2026-12-01T00:00:00Z"))).toBe(true);
    expect(cardExpiredBy(null, null, new Date())).toBe(false);
  });
});

describe("Monthly Vault gifts", () => {
  const paystack = new FakeRecurringPaystack();
  const { core, emails } = createFakeRecurringGiftsCore(paystack);
  const ledger = new VaultLedgerService();
  const unused = { createPayment: jest.fn(), verifyAndParseWebhook: jest.fn() };
  const contributions = new VaultContributionsService(
    new EncryptionService(),
    { sendReceipt: async () => undefined } as any,
    ledger,
    new FunnelEventsService(),
    core,
    unused as any,
    paystack as any,
    unused as any,
  );
  // Waqf top-ups have their own describe block below.
  const service = new RecurringGiftsService(core, new VaultMonthlyProduct(contributions), new WaqfMonthlyProduct(null as any), new ZakahMonthlyProduct(null as any));
  const vaultsService = new VaultsService(new VaultProceedsService(), ledger);

  const run = Date.now().toString(36);
  let n = 0;
  const vaultIds: string[] = [];
  const emailsUsed: string[] = [];
  let actorUserId: string;
  let vaultId: string;
  let minimum: string;

  async function openVault(name: string) {
    const vault = await vaultsService.create(
      { name, slug: `monthly-${run}-${n++}`, type: "project", currency: "NGN", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await prisma.$transaction((tx) => vaultsService.publish(vault.id, tx));
    return vault.id;
  }

  function newEmail() {
    const email = `monthly-${run}-${n++}@example.com`;
    emailsUsed.push(email);
    return email;
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

  /** A monthly gift set up through the real flow: checkout, then the confirmation that saves the card. */
  async function activeGift(options: { amount?: string; email?: string; vault?: string } = {}) {
    const result = await contributions.initiate({
      vaultId: options.vault ?? vaultId,
      amount: options.amount ?? minimum,
      currency: "NGN",
      provider: "paystack",
      donorEmail: options.email ?? newEmail(),
      monthly: true,
    });
    await contributions.reconcile(result.contribution.id);
    const gift = await waitFor(
      () => prisma.recurringGift.findUniqueOrThrow({ where: { id: result.contribution.recurringGiftId! } }),
      (g) => g.status !== "pending_setup",
    );
    return { gift, contributionId: result.contribution.id };
  }

  /** The private link the setup email carried. */
  function tokenFor(gift: RecurringGift): string {
    const mail = emails.sent.find((e) => e.to === gift.email && e.subject === "Your monthly gift is set up");
    return mail!.ctaUrl!.split("/giving/manage/")[1];
  }

  const due = (gift: RecurringGift) => prisma.recurringGift.update({ where: { id: gift.id }, data: { nextChargeAt: new Date(Date.now() - 60_000) } });
  const reload = (gift: RecurringGift) => prisma.recurringGift.findUniqueOrThrow({ where: { id: gift.id } });

  beforeAll(async () => {
    const actor = await prisma.user.create({ data: { email: `monthly-actor-${run}@example.com`, fullName: "Monthly Actor" } });
    actorUserId = actor.id;
    await prisma.birrStaff.create({ data: { userId: actor.id, roles: { create: { role: "mutawalli_officer" } } } });
    vaultId = await openVault("Monthly Giving Vault");
    minimum = (await prisma.contributionMinimum.findUniqueOrThrow({ where: { currency: "NGN" } })).minAmount.toFixed(2);
  });

  beforeEach(() => {
    paystack.card = REUSABLE_CARD;
    paystack.nextCharge = { status: "confirmed", providerPaymentId: "pay_fake" };
  });

  afterAll(async () => {
    const gifts = await prisma.recurringGift.findMany({ where: { email: { in: emailsUsed } }, select: { id: true } });
    const giftIds = gifts.map((g) => g.id);
    const rows = await prisma.vaultContribution.findMany({ where: { vaultId: { in: vaultIds } }, select: { id: true } });
    await prisma.vaultJournalEntryLine.deleteMany({ where: { journalEntry: { vaultId: { in: vaultIds } } } });
    await prisma.vaultJournalEntry.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultContribution.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await prisma.recurringGift.deleteMany({ where: { id: { in: giftIds } } });
    await prisma.vaultDonor.deleteMany({ where: { email: { in: emailsUsed } } });
    await prisma.vaultCause.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.$disconnect();
  });

  test("setting up starts with a card-only checkout; confirming it saves the card, schedules next month, and emails a private link", async () => {
    const email = newEmail();
    const result = await contributions.initiate({ vaultId, amount: minimum, currency: "NGN", provider: "paystack", donorEmail: email, monthly: true });
    expect(paystack.checkouts.find((c) => c.reference === result.contribution.id)).toMatchObject({ cardOnly: true });
    const pending = await prisma.recurringGift.findUniqueOrThrow({ where: { id: result.contribution.recurringGiftId! } });
    expect(pending).toMatchObject({ status: "pending_setup", kind: "vault", email, nextPeriod: periodOf(new Date()) });
    expect(result.contribution.recurringPeriod).toBe(pending.nextPeriod);

    await contributions.reconcile(result.contribution.id);
    const gift = await waitFor(() => reload(pending), (g) => g.status === "active");
    expect(gift).toMatchObject({ cardLast4: "4081", cardExpYear: 2030, nextPeriod: addMonths(pending.nextPeriod, 1), failedAttempts: 0 });
    expect(gift.nextChargeAt).toEqual(chargeDateFor(gift.nextPeriod, gift.dayOfMonth));
    // The card is stored encrypted, never as Paystack's code.
    expect(gift.authorizationEncrypted).not.toContain(REUSABLE_CARD.authorizationCode);
    expect(gift.manageTokenHash).toMatch(/^[0-9a-f]{64}$/);

    const token = tokenFor(gift);
    expect(token.length).toBeGreaterThan(30);
    expect((await service.view(token)).status).toBe("active");

    const actions = (await prisma.auditLog.findMany({ where: { entityId: gift.id }, orderBy: { sequence: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["recurring_gift.set_up_started", "recurring_gift.activated"]);
    // The audit trail never holds the saved card.
    const trail = JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: gift.id } }));
    expect(trail).not.toContain(gift.authorizationEncrypted!);
  });

  test("monthly giving needs an email, a card and naira", async () => {
    await expect(
      contributions.initiate({ vaultId, amount: minimum, currency: "NGN", provider: "paystack", monthly: true }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      contributions.initiate({ vaultId, amount: minimum, currency: "USD", provider: "paystack", donorEmail: newEmail(), monthly: true }),
    ).rejects.toThrow("Monthly giving is by card, in naira.");
  });

  test("a card Paystack can't charge again ends the gift, and the first payment still counts", async () => {
    paystack.card = { ...REUSABLE_CARD, reusable: false };
    const { gift, contributionId } = await activeGift();
    expect(gift).toMatchObject({ status: "ended", endedReason: "card_not_reusable" });
    expect((await prisma.vaultContribution.findUniqueOrThrow({ where: { id: contributionId } })).status).toBe("confirmed");
  });

  test("a due month is charged once, even when two runs reach it together; the database refuses a second charge", async () => {
    const { gift } = await activeGift();
    await due(gift);
    const before = paystack.charges.length;

    await Promise.all([service.processDue(gift.id), service.processDue(gift.id)]);

    expect(paystack.charges.length - before).toBe(1);
    const charged = await prisma.vaultContribution.findMany({ where: { recurringGiftId: gift.id, recurringPeriod: gift.nextPeriod } });
    expect(charged).toHaveLength(1);
    expect(charged[0].status).toBe("confirmed");
    const after = await reload(gift);
    expect(after.nextPeriod).toBe(addMonths(gift.nextPeriod, 1));
    expect(await prisma.auditLog.count({ where: { entityId: gift.id, action: "recurring_gift.month_collected" } })).toBe(1);

    await expect(
      prisma.vaultContribution.create({
        data: { vaultId, amount: minimum, currency: "NGN", provider: "paystack", providerReference: `dup-${run}-${n++}`, recurringGiftId: gift.id, recurringPeriod: gift.nextPeriod },
      }),
    ).rejects.toThrow();
  });

  test("a declined month is tried again a day later and three days after that, then the gift pauses", async () => {
    const { gift } = await activeGift();
    await due(gift);
    paystack.nextCharge = { status: "failed", gatewayResponse: "Insufficient Funds" };
    const start = Date.now();

    await service.processDue(gift.id, new Date(start));
    let current = await reload(gift);
    expect(current).toMatchObject({ status: "active", failedAttempts: 1, nextPeriod: gift.nextPeriod });
    expect(current.nextChargeAt!.getTime()).toBeGreaterThanOrEqual(start + DAY_MS - 1000);

    // Not yet due again: nothing happens.
    const charges = paystack.charges.length;
    await service.processDue(gift.id, new Date(start + 60_000));
    expect(paystack.charges.length).toBe(charges);

    await service.processDue(gift.id, new Date(start + DAY_MS + 60_000));
    current = await reload(gift);
    expect(current.failedAttempts).toBe(2);

    await service.processDue(gift.id, new Date(start + 4 * DAY_MS + 60_000));
    current = await reload(gift);
    expect(current).toMatchObject({ status: "paused", pauseReason: "card_failed", nextChargeAt: null });
    expect(await prisma.vaultContribution.count({ where: { recurringGiftId: gift.id, status: "failed" } })).toBe(3);
    expect(emails.sent.filter((e) => e.to === gift.email && e.subject === "Your monthly gift didn't go through")).toHaveLength(3);

    // Updating the card collects the month that's due, on the new card, and starts the gift again.
    paystack.card = { ...REUSABLE_CARD, authorizationCode: "AUTH_new_card", last4: "1234" };
    const { checkoutUrl } = await service.startCardUpdate(tokenFor(gift));
    const reference = checkoutUrl.split("/").pop()!;
    expect(paystack.checkouts.find((c) => c.reference === reference)).toMatchObject({ cardOnly: true });
    await contributions.reconcile(reference);
    current = await waitFor(() => reload(gift), (g) => g.status === "active");
    expect(current).toMatchObject({ cardLast4: "1234", failedAttempts: 0, nextPeriod: addMonths(gift.nextPeriod, 1) });
    expect(await prisma.auditLog.count({ where: { entityId: gift.id, action: "recurring_gift.card_updated" } })).toBe(1);
  });

  test("the card can only be updated when a payment has failed or the card has expired", async () => {
    const { gift } = await activeGift();
    await expect(service.startCardUpdate(tokenFor(gift))).rejects.toThrow(BadRequestException);
  });

  test("an expired card pauses the gift before any charge", async () => {
    const { gift } = await activeGift();
    await prisma.recurringGift.update({ where: { id: gift.id }, data: { cardExpMonth: 1, cardExpYear: 2020, nextChargeAt: new Date(Date.now() - 1000) } });
    const before = paystack.charges.length;
    await service.processDue(gift.id);
    expect(paystack.charges.length).toBe(before);
    expect(await reload(gift)).toMatchObject({ status: "paused", pauseReason: "card_expired" });
  });

  test("a closed Vault ends its monthly gifts", async () => {
    const closing = await openVault("Closing Vault");
    const { gift } = await activeGift({ vault: closing });
    await prisma.vault.update({ where: { id: closing }, data: { status: "closed" } });
    await due(gift);
    await service.processDue(gift.id);
    expect(await reload(gift)).toMatchObject({ status: "ended", endedReason: "vault_closed", nextChargeAt: null });
    expect(emails.sent.some((e) => e.to === gift.email && e.subject === "Your monthly gift has ended")).toBe(true);
  });

  test("a donor without an ID who reaches the AML threshold is paused for it; giving it resumes the gift", async () => {
    const threshold = (await prisma.vaultDonorThreshold.findUniqueOrThrow({ where: { currency: "NGN" } })).thresholdAmount;
    // Each gift is a little over half the threshold: the first passes, the second needs an ID.
    const amount = new Prisma.Decimal(threshold).div(2).plus(1000).toFixed(2);
    const { gift } = await activeGift({ amount });
    await due(gift);
    await service.processDue(gift.id);
    expect(await reload(gift)).toMatchObject({ status: "paused", pauseReason: "needs_identity" });
    expect(await prisma.vaultContribution.count({ where: { recurringGiftId: gift.id, recurringPeriod: gift.nextPeriod } })).toBe(0);

    await service.provideIdentity(tokenFor(gift), { fullName: "Amina Bello", idType: "national_id", idNumber: "12345678901" });
    const resumed = await reload(gift);
    expect(resumed.status).toBe("active");
    expect(await prisma.auditLog.count({ where: { entityType: "VaultDonor", action: { in: ["vault_donor.identity_captured", "vault_donor.created"] }, after: { path: ["email"], equals: gift.email } } })).toBeGreaterThan(0);

    // An ID on file is enough for a scheduled charge on the donor's own card.
    await service.processDue(resumed.id);
    expect((await reload(gift)).nextPeriod).toBe(addMonths(gift.nextPeriod, 1));
  });

  test("the private link: a wrong one is refused; the amount can change but not below the minimum; cancelling stops all charges", async () => {
    const { gift } = await activeGift();
    const token = tokenFor(gift);
    await expect(service.view("not-a-real-token")).rejects.toThrow(NotFoundException);

    await expect(service.changeAmount(token, { amount: "100" })).rejects.toThrow(BadRequestException);
    const raised = new Prisma.Decimal(minimum).plus(5000).toFixed(2);
    expect((await service.changeAmount(token, { amount: raised })).amount).toBe(new Prisma.Decimal(raised).toString());
    expect(await prisma.auditLog.count({ where: { entityId: gift.id, action: "recurring_gift.amount_changed" } })).toBe(1);

    const cancelled = await service.cancel(token);
    expect(cancelled.status).toBe("cancelled");
    expect(await prisma.auditLog.count({ where: { entityId: gift.id, action: "recurring_gift.cancelled" } })).toBe(1);
    expect(emails.sent.some((e) => e.to === gift.email && e.subject === "Your monthly gift is cancelled")).toBe(true);

    await prisma.recurringGift.update({ where: { id: gift.id }, data: { nextChargeAt: new Date(Date.now() - 1000) } }).catch(() => null);
    const before = paystack.charges.length;
    await service.processDue(gift.id);
    expect(paystack.charges.length).toBe(before);
  });

  test("asking for links replaces them; an email with no monthly gift gets the same answer and no email", async () => {
    const { gift } = await activeGift();
    const oldToken = tokenFor(gift);
    const sentBefore = emails.sent.length;

    expect(await service.requestManageLinks({ email: gift.email.toUpperCase() })).toEqual({ sent: true });
    const mail = emails.sent.slice(sentBefore).find((e) => e.to === gift.email)!;
    const newToken = mail.bodyHtml.match(/giving\/manage\/([A-Za-z0-9_-]+)/)![1];
    await expect(service.view(oldToken)).rejects.toThrow(NotFoundException);
    expect((await service.view(newToken)).status).toBe("active");

    const count = emails.sent.length;
    expect(await service.requestManageLinks({ email: `nobody-${run}@example.com` })).toEqual({ sent: true });
    expect(emails.sent.length).toBe(count);
  });

  test("the database keeps monthly gifts in naira, on days every month has, and never active without a card", async () => {
    const base = { kind: "vault" as const, email: newEmail(), amount: "1000", dayOfMonth: 5, nextPeriod: "2026-12", vaultId };
    await expect(prisma.recurringGift.create({ data: { ...base, currency: "USD" } })).rejects.toThrow();
    await expect(prisma.recurringGift.create({ data: { ...base, dayOfMonth: 29 } })).rejects.toThrow();
    await expect(prisma.recurringGift.create({ data: { ...base, status: "active", nextChargeAt: new Date() } })).rejects.toThrow();
    await expect(prisma.recurringGift.create({ data: { ...base, kind: "waqf" } })).rejects.toThrow();
  });
});

describe("Monthly Waqf Fund top-ups", () => {
  const paystack = new FakeRecurringPaystack();
  const { core, emails } = createFakeRecurringGiftsCore(paystack);
  const unused = { createPayment: jest.fn(), verifyAndParseWebhook: jest.fn() };
  const contributions = new ContributionsService(
    new AssetsService(),
    createFakeNotificationsService(),
    new WaqfLedgerService(),
    core,
    unused as any,
    paystack as any,
    unused as any,
  );
  const service = new RecurringGiftsService(core, new VaultMonthlyProduct(null as any), new WaqfMonthlyProduct(contributions), new ZakahMonthlyProduct(null as any));

  const run = Date.now().toString(36);
  const waqfIds: string[] = [];
  let founderId: string;
  let otherFounderId: string;
  let foundationId: string;
  let minimum: string;

  async function fundedWaqf(name: string, funded = true) {
    const waqf = await prisma.waqf.create({
      data: { name, type: "investment", jurisdiction: "NG", foundationId, corpusCurrency: "NGN", status: funded ? "active" : "draft" },
    });
    waqfIds.push(waqf.id);
    if (funded) {
      await prisma.contribution.create({
        data: { waqfId: waqf.id, amount: minimum, currency: "NGN", provider: "paystack", providerReference: `first-${waqf.id}`, status: "confirmed", confirmedAt: new Date() },
      });
    }
    return waqf.id;
  }

  async function setUp(waqfId: string) {
    const result = await contributions.initiate({ waqfId, amount: minimum, currency: "NGN", provider: "paystack", founderId, payerEmail: `founder-${run}@example.com`, monthly: true });
    await contributions.reconcileForFounder(result.contribution.id, founderId);
    const deadline = Date.now() + 10_000;
    let gift = await prisma.recurringGift.findUniqueOrThrow({ where: { id: result.contribution.recurringGiftId! } });
    while (gift.status === "pending_setup" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      gift = await prisma.recurringGift.findUniqueOrThrow({ where: { id: gift.id } });
    }
    return { gift, result };
  }

  beforeAll(async () => {
    founderId = (await prisma.founder.create({ data: { name: "Monthly Top-up Founder", kind: "individual" } })).id;
    otherFounderId = (await prisma.founder.create({ data: { name: "Other Founder", kind: "individual" } })).id;
    foundationId = (await prisma.foundation.create({ data: { name: "Monthly Top-up Foundation" } })).id;
    await prisma.foundationFounder.create({ data: { foundationId, founderId } });
    minimum = (await prisma.contributionMinimum.findUniqueOrThrow({ where: { currency: "NGN" } })).minAmount.toFixed(2);
  });

  afterAll(async () => {
    const giftIds = (await prisma.recurringGift.findMany({ where: { waqfId: { in: waqfIds } }, select: { id: true } })).map((g) => g.id);
    const rows = await prisma.contribution.findMany({ where: { waqfId: { in: waqfIds } }, select: { id: true, assetId: true } });
    await prisma.waqfJournalEntryLine.deleteMany({ where: { journalEntry: { waqfId: { in: waqfIds } } } });
    await prisma.waqfJournalEntry.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.contribution.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await prisma.asset.deleteMany({ where: { id: { in: rows.map((r) => r.assetId).filter((a): a is string => a != null) } } });
    await prisma.recurringGift.deleteMany({ where: { id: { in: giftIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("a top-up can only start once the fund's first contribution has gone through", async () => {
    const unfunded = await fundedWaqf("Unfunded Fund", false);
    await expect(
      contributions.initiate({ waqfId: unfunded, amount: minimum, currency: "NGN", provider: "paystack", founderId, payerEmail: "f@example.com", monthly: true }),
    ).rejects.toThrow("first contribution has gone through");
  });

  test("setting up saves the founder's card under their email, and emails point to the portal, not a private link", async () => {
    const waqfId = await fundedWaqf("Top-up Fund");
    const { gift, result } = await setUp(waqfId);
    expect(paystack.checkouts.find((c) => c.reference === result.contribution.id)).toMatchObject({ cardOnly: true });
    expect(gift).toMatchObject({ kind: "waqf", status: "active", founderId, email: `founder-${run}@example.com`, manageTokenHash: null });
    const mail = emails.sent.find((e) => e.ctaUrl?.endsWith(`/portfolio/${waqfId}`))!;
    expect(mail.subject).toBe("Your monthly gift is set up");
    expect(await prisma.auditLog.findFirst({ where: { entityId: gift.id, action: "recurring_gift.set_up_started" } })).toMatchObject({
      actorType: "founder_user",
      actorFounderId: founderId,
      waqfId,
    });

    // One top-up per fund.
    await expect(
      contributions.initiate({ waqfId, amount: minimum, currency: "NGN", provider: "paystack", founderId, payerEmail: "f@example.com", monthly: true }),
    ).rejects.toThrow("already has a monthly top-up");
  });

  test("a due month is charged on the saved card under the founder's email, and booked like any contribution", async () => {
    const waqfId = await fundedWaqf("Charged Fund");
    const { gift } = await setUp(waqfId);
    await prisma.recurringGift.update({ where: { id: gift.id }, data: { nextChargeAt: new Date(Date.now() - 1000) } });
    await service.processDue(gift.id);

    expect(paystack.charges.at(-1)).toMatchObject({ email: gift.email, authorizationCode: REUSABLE_CARD.authorizationCode });
    const charged = await prisma.contribution.findFirstOrThrow({ where: { recurringGiftId: gift.id, recurringPeriod: gift.nextPeriod } });
    expect(charged.status).toBe("confirmed");
    expect(await prisma.waqfJournalEntry.count({ where: { sourceId: charged.id } })).toBeGreaterThan(0);
    expect((await prisma.recurringGift.findUniqueOrThrow({ where: { id: gift.id } })).nextPeriod).toBe(addMonths(gift.nextPeriod, 1));
  });

  test("only the founder sees and changes their top-up; it can be changed and cancelled", async () => {
    const waqfId = await fundedWaqf("Managed Fund");
    const { gift } = await setUp(waqfId);
    expect((await service.founderTopUp(waqfId, founderId))?.status).toBe("active");
    await expect(service.founderTopUp(waqfId, otherFounderId)).rejects.toThrow(NotFoundException);
    await expect(service.founderCancel(waqfId, otherFounderId)).rejects.toThrow(NotFoundException);

    const raised = new Prisma.Decimal(minimum).plus(10000).toFixed(2);
    expect((await service.founderChangeAmount(waqfId, founderId, { amount: raised })).amount).toBe(new Prisma.Decimal(raised).toString());
    expect((await service.founderCancel(waqfId, founderId)).status).toBe("cancelled");
    expect(await service.founderTopUp(waqfId, founderId)).toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { entityId: gift.id, action: "recurring_gift.cancelled" } })).toMatchObject({ actorType: "founder_user" });
  });

  test("a fund that is no longer active ends its top-up", async () => {
    const waqfId = await fundedWaqf("Suspended Fund");
    const { gift } = await setUp(waqfId);
    await prisma.waqf.update({ where: { id: waqfId }, data: { status: "suspended" } });
    await prisma.recurringGift.update({ where: { id: gift.id }, data: { nextChargeAt: new Date(Date.now() - 1000) } });
    await service.processDue(gift.id);
    expect(await prisma.recurringGift.findUniqueOrThrow({ where: { id: gift.id } })).toMatchObject({ status: "ended", endedReason: "waqf_inactive" });
  });
});

describe("Monthly zakah (paid in advance)", () => {
  const paystack = new FakeRecurringPaystack();
  const { core, emails } = createFakeRecurringGiftsCore(paystack);
  const settings = { get: async (provider: string, key: string) => (provider === "paystack" && key === "ZAKAH_SUBACCOUNT_CODE" ? "ACCT_test_zakah" : undefined) };
  const payments = new ZakahPaymentsService(
    new EncryptionService(),
    settings as any,
    paystack as any,
    new ZakahLedgerService(),
    { sendReceipt: async () => undefined } as any,
    new ZakahFitrService(),
    core,
  );
  const service = new RecurringGiftsService(core, new VaultMonthlyProduct(null as any), new WaqfMonthlyProduct(null as any), new ZakahMonthlyProduct(payments));
  const run = Date.now().toString(36);
  let n = 0;
  const terms = ZAKAH_WAKALAH_TERMS.version;

  async function setUp(amount = "50000", coverFee = true) {
    const email = `monthly-zakah-${run}-${n++}@example.com`;
    const result = await payments.initiate({ kind: "mal", amount, coverFee, wakalahConsentVersion: terms, payerEmail: email, monthly: true });
    await payments.reconcile(result.payment.id);
    const row = await prisma.zakahPayment.findUniqueOrThrow({ where: { id: result.payment.id } });
    const deadline = Date.now() + 10_000;
    let gift = await prisma.recurringGift.findUniqueOrThrow({ where: { id: row.recurringGiftId! } });
    while (gift.status === "pending_setup" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      gift = await prisma.recurringGift.findUniqueOrThrow({ where: { id: gift.id } });
    }
    return { gift, row };
  }

  const tokenFor = (gift: RecurringGift) =>
    emails.sent.find((e) => e.to === gift.email && e.subject === "Your monthly zakah is set up")!.ctaUrl!.split("/giving/manage/")[1];
  const reload = (gift: RecurringGift) => prisma.recurringGift.findUniqueOrThrow({ where: { id: gift.id } });
  const due = (gift: RecurringGift) => prisma.recurringGift.update({ where: { id: gift.id }, data: { nextChargeAt: new Date(Date.now() - 1000) } });

  beforeEach(() => {
    paystack.card = REUSABLE_CARD;
    paystack.nextCharge = { status: "confirmed", providerPaymentId: "pay_fake" };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("setting up goes into the zakah account by card, recording the terms, the fee cover and the calculation's prices", async () => {
    const { gift, row } = await setUp();
    expect(paystack.checkouts.find((c) => c.reference === row.id)).toMatchObject({ cardOnly: true });
    expect(row).toMatchObject({ settlementSubaccount: "ACCT_test_zakah", recurringPeriod: periodOf(new Date()) });
    expect(Number(row.feeCover)).toBeGreaterThan(0);
    expect(gift).toMatchObject({ kind: "zakah", status: "active", coverFee: true, wakalahConsentVersion: terms, zakahMetalPriceId: row.metalPriceId });
    expect(emails.sent.find((e) => e.to === gift.email)!.bodyHtml).toContain("zakah paid in advance");
  });

  test("Zakah al-Fitr can't be monthly, and monthly zakah needs an email", async () => {
    await expect(
      payments.initiate({ kind: "fitr", fitrPeople: 2, fitrForm: "food", coverFee: false, wakalahConsentVersion: terms, payerEmail: "f@example.com", monthly: true }),
    ).rejects.toThrow("Zakah al-Fitr is paid once a year");
    await expect(payments.initiate({ kind: "mal", amount: "50000", coverFee: false, wakalahConsentVersion: terms, monthly: true })).rejects.toThrow(
      "Monthly zakah needs your email",
    );
  });

  test("a month is charged into the zakah account with the fee cover, recording the setup's prices", async () => {
    const { gift, row } = await setUp();
    await due(gift);
    await service.processDue(gift.id);
    const charge = paystack.charges.at(-1)!;
    expect(charge.split).toEqual({ subaccount: "ACCT_test_zakah", mainAccountShareMinorUnits: Math.round(Number(row.feeCover) * 100) });
    expect(Number(charge.amount)).toBeCloseTo(Number(row.amount) + Number(row.feeCover), 2);
    const month = await prisma.zakahPayment.findFirstOrThrow({ where: { recurringGiftId: gift.id, recurringPeriod: gift.nextPeriod } });
    expect(month).toMatchObject({ status: "confirmed", metalPriceId: row.metalPriceId, wakalahConsentVersion: terms, pool: "mal" });
  });

  test("changed wakalah terms pause the gift until the payer accepts the new wording", async () => {
    const { gift } = await setUp("50000", false);
    await prisma.recurringGift.update({ where: { id: gift.id }, data: { wakalahConsentVersion: "an-older-wording" } });
    await due(gift);
    const before = paystack.charges.length;
    await service.processDue(gift.id);
    expect(paystack.charges.length).toBe(before);
    expect(await reload(gift)).toMatchObject({ status: "paused", pauseReason: "terms_changed" });

    const token = tokenFor(gift);
    await expect(service.acceptZakahTerms(token, { version: "an-older-wording" })).rejects.toThrow(BadRequestException);
    expect((await service.acceptZakahTerms(token, { version: terms })).status).toBe("active");
    expect(await reload(gift)).toMatchObject({ wakalahConsentVersion: terms, pauseReason: null });
    expect(await prisma.auditLog.count({ where: { entityId: gift.id, action: "recurring_gift.terms_accepted" } })).toBe(1);
  });

  test("a payer reaching the AML threshold without an ID is paused for it; giving it resumes the gift", async () => {
    const threshold = (await prisma.vaultDonorThreshold.findUniqueOrThrow({ where: { currency: "NGN" } })).thresholdAmount;
    const { gift } = await setUp(new Prisma.Decimal(threshold).div(2).plus(1000).toFixed(2), false);
    await due(gift);
    await service.processDue(gift.id);
    expect(await reload(gift)).toMatchObject({ status: "paused", pauseReason: "needs_identity" });

    await service.provideIdentity(tokenFor(gift), { fullName: "Yusuf Bello", idType: "national_id", idNumber: "98765432109" });
    expect((await prisma.zakahPayer.findUniqueOrThrow({ where: { email: gift.email } })).idNumberEncrypted).not.toBeNull();
    await service.processDue(gift.id);
    expect((await reload(gift)).nextPeriod).toBe(addMonths(gift.nextPeriod, 1));
  });
});

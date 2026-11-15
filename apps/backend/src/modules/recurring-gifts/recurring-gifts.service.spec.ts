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
  const service = new RecurringGiftsService(core, contributions, new VaultMonthlyProduct(contributions));
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

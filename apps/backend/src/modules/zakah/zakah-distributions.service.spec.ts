import { prisma, Prisma } from "@birr/db";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EncryptionService } from "../../common/settings/encryption.service";
import { ZAKAH_BANK_ACCOUNT_CODE, ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE, ZakahLedgerService } from "./zakah-ledger.service";
import { ZakahDistributionsService } from "./zakah-distributions.service";

// Zakah distributions, recipients and the ledger are append-only by
// design, so these fixtures stay in the shared dev database. Each run
// funds itself first (a confirmed payment, booked in the ledger like a
// real one), so the zakah it commits never drains what other runs need.
describe("ZakahDistributionsService", () => {
  const encryption = new EncryptionService();
  const ledger = new ZakahLedgerService();
  const service = new ZakahDistributionsService(encryption, ledger);
  const run = Date.now().toString(36);

  let officerUserId: string;
  let checkerUserId: string;
  let partnerId: string;
  let pendingPartnerId: string;

  async function fundZakah(amount: string) {
    await prisma.$transaction(async (tx) => {
      const id = randomUUID();
      await tx.zakahPayment.create({
        data: {
          id,
          amount,
          currency: "NGN",
          provider: "paystack",
          providerReference: id,
          status: "confirmed",
          confirmedAt: new Date(),
          settlementSubaccount: "ACCT_test_zakah",
          wakalahConsentVersion: "test",
        },
      });
      const bank = await ledger.getAccountByCode(tx, ZAKAH_BANK_ACCOUNT_CODE);
      const held = await ledger.getAccountByCode(tx, ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE);
      await ledger.post(tx, {
        description: "Test fixture zakah payment",
        currency: "NGN",
        source: "payment",
        sourceId: id,
        actorType: "system",
        lines: [
          { ledgerAccountId: bank.id, debit: amount },
          { ledgerAccountId: held.id, credit: amount },
        ],
      });
    });
  }

  async function governedAction(permissionKey: string, payload: object) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } });
    return prisma.governedAction.create({
      data: {
        permissionId: permission.id,
        makerType: "human",
        makerUserId: officerUserId,
        checkerUserId,
        status: "approved",
        decidedAt: new Date(),
        payload,
      },
    });
  }

  async function recipient(categories: ("fuqara" | "gharimin" | "ibn_sabil")[] = ["fuqara"]) {
    return service.createRecipient(
      {
        name: `Test Recipient ${run}`,
        categories,
        eligibilityReason: "Household income below the poverty line, verified by home visit.",
        bankName: "Test Bank",
        accountNumber: "0123456789",
        accountName: "Test Recipient",
      },
      officerUserId,
    );
  }

  async function approve(distributionId: string) {
    const action = await governedAction("zakah.distribution_approve", { distributionId });
    return prisma.$transaction((tx) => service.approve({ distributionId }, action.id, tx));
  }

  async function markPaid(distributionId: string, bankReference = `REF-${randomUUID().slice(0, 8)}`) {
    const payload = { distributionId, bankReference, paidOn: new Date().toISOString().slice(0, 10) };
    const action = await governedAction("zakah.distribution_mark_paid", payload);
    return prisma.$transaction((tx) => service.markPaid(payload, action.id, tx));
  }

  beforeAll(async () => {
    const officer = await prisma.user.create({ data: { email: `zakah-dist-officer-${run}@example.com`, fullName: "Test Zakah Officer" } });
    officerUserId = officer.id;
    await prisma.birrStaff.create({ data: { userId: officer.id, roles: { create: { role: "mutawalli_officer" } } } });
    const checker = await prisma.user.create({ data: { email: `zakah-dist-checker-${run}@example.com`, fullName: "Test Zakah Checker" } });
    checkerUserId = checker.id;
    await prisma.birrStaff.create({ data: { userId: checker.id, roles: { create: { role: "compliance_officer" } } } });
    partnerId = (
      await prisma.counterparty.create({
        data: { name: `Zakah Partner ${run}`, institutionType: "bank", jurisdiction: "NG", status: "active" },
      })
    ).id;
    pendingPartnerId = (
      await prisma.counterparty.create({ data: { name: `Unvetted Zakah Partner ${run}`, institutionType: "bank", jurisdiction: "NG" } })
    ).id;
    await fundZakah("1000000");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("recipients", () => {
    test("stores bank details encrypted, lists only the last four digits, and audits without them", async () => {
      const r = await recipient();
      expect(r.bank).toEqual({ bankName: "Test Bank", accountLast4: "6789" });
      expect(r).not.toHaveProperty("bankDetailsEncrypted");

      const row = await prisma.zakahRecipient.findUniqueOrThrow({ where: { id: r.id } });
      expect(row.bankDetailsEncrypted).not.toContain("0123456789");
      const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "zakah_recipient.created" } });
      expect(JSON.stringify(log.after)).not.toContain("bankDetailsEncrypted");
      expect(log.after).toMatchObject({ bankDetailsOnFile: true });
    });

    test("full bank details are a separate read, and every read is audited", async () => {
      const r = await recipient();
      expect(await service.bankDetails(r.id, officerUserId)).toEqual({
        bankName: "Test Bank",
        accountNumber: "0123456789",
        accountName: "Test Recipient",
      });
      expect(await prisma.auditLog.count({ where: { entityId: r.id, action: "zakah_recipient.bank_details_viewed" } })).toBe(1);
    });

    test("refuses the closed administrators' category, and half-given bank details", async () => {
      await expect(
        service.createRecipient({ name: "X", categories: ["amilin"], eligibilityReason: "Works for Birr on zakah." }, officerUserId),
      ).rejects.toThrow(/all zakah goes to recipients/);
      await expect(
        service.createRecipient(
          { name: "Y", categories: ["fuqara"], eligibilityReason: "Verified by home visit.", bankName: "Test Bank" },
          officerUserId,
        ),
      ).rejects.toThrow(/together, or none/);
    });

    test("an update is audited, and deactivating stops new distributions", async () => {
      const r = await recipient();
      await service.updateRecipient(
        r.id,
        { name: r.name, categories: ["fuqara"], eligibilityReason: r.eligibilityReason, active: false },
        officerUserId,
      );
      expect(await prisma.auditLog.count({ where: { entityId: r.id, action: "zakah_recipient.updated" } })).toBe(1);
      await expect(
        service.create({ recipientId: r.id, category: "fuqara", amount: "1000", reason: "Monthly support for food." }, officerUserId),
      ).rejects.toThrow(/no longer an active recipient/);
    });
  });

  describe("creating a distribution", () => {
    test("is audited and counts against the zakah available", async () => {
      const r = await recipient();
      const before = await service.summary();
      const d = await service.create({ recipientId: r.id, category: "fuqara", amount: "5000", reason: "Food for the month of Ramadan." }, officerUserId);

      expect(d).toMatchObject({ status: "pending_approval", category: "fuqara", currency: "NGN" });
      expect(await prisma.auditLog.count({ where: { entityId: d.id, action: "zakah_distribution.created" } })).toBe(1);
      const after = await service.summary();
      expect(new Prisma.Decimal(after.committed).minus(before.committed).gte(5000)).toBe(true);
    });

    test("must be in a category the recipient is registered under", async () => {
      const r = await recipient(["fuqara"]);
      await expect(
        service.create({ recipientId: r.id, category: "gharimin", amount: "1000", reason: "Paying off a medical debt." }, officerUserId),
      ).rejects.toThrow(/isn't registered as eligible/);
    });

    test("can never exceed the zakah available", async () => {
      const r = await recipient();
      const { available } = await service.summary();
      const tooMuch = new Prisma.Decimal(available).plus("1000000000").toFixed(2);
      await expect(
        service.create({ recipientId: r.id, category: "fuqara", amount: tooMuch, reason: "More than has been received." }, officerUserId),
      ).rejects.toThrow(/of zakah is available to distribute/);
    });

    test("goes to exactly one payee, and a partner must be active", async () => {
      const r = await recipient();
      await expect(service.create({ category: "fuqara", amount: "1000", reason: "Nobody to pay this to." }, officerUserId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.create({ recipientId: r.id, counterpartyId: partnerId, category: "fuqara", amount: "1000", reason: "Two payees at once." }, officerUserId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ counterpartyId: pendingPartnerId, category: "fuqara", amount: "1000", reason: "Food parcels in Kano." }, officerUserId),
      ).rejects.toThrow(/isn't an active, vetted partner/);
    });
  });

  describe("approving and paying", () => {
    test("approve → paid books the zakah out of the account, tagged with its category", async () => {
      const r = await recipient(["gharimin"]);
      const d = await service.create({ recipientId: r.id, category: "gharimin", amount: "20000", reason: "Clearing a school-fees debt." }, officerUserId);

      const approved = await approve(d.id);
      expect(approved.after).toMatchObject({ status: "approved", approvalActionId: expect.any(String) });

      const paid = await markPaid(d.id, `REF-${run}`);
      expect(paid.after).toMatchObject({ status: "paid", bankReference: `REF-${run}` });

      const entry = await prisma.zakahJournalEntry.findFirstOrThrow({
        where: { source: "distribution", sourceId: d.id },
        include: { lines: { include: { ledgerAccount: true } } },
      });
      expect(entry.description).toContain("those in debt");
      expect(entry.lines.map((l) => ({ code: l.ledgerAccount.code, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2) }))).toEqual(
        expect.arrayContaining([
          { code: "2000", debit: "20000.00", credit: "0.00" },
          { code: "1000", debit: "0.00", credit: "20000.00" },
        ]),
      );
    });

    test("rejecting releases the amount back to what can be distributed", async () => {
      const r = await recipient();
      const d = await service.create({ recipientId: r.id, category: "fuqara", amount: "7000", reason: "Rent arrears for a widow." }, officerUserId);
      const committedBefore = new Prisma.Decimal((await service.summary()).committed);

      const result = await prisma.$transaction((tx) => service.reject({ distributionId: d.id }, tx));
      expect(result?.after.status).toBe("rejected");
      expect(new Prisma.Decimal((await service.summary()).committed).lte(committedBefore.minus(7000))).toBe(true);
    });

    test("only an approved distribution can be marked paid, and not with a future date", async () => {
      const r = await recipient();
      const d = await service.create({ recipientId: r.id, category: "fuqara", amount: "1000", reason: "Food for the month." }, officerUserId);
      await expect(service.validatePaidProposalAsync({ distributionId: d.id, bankReference: "REF-1", paidOn: "2026-01-01" })).rejects.toThrow(
        /Only an approved distribution/,
      );
      expect(() => service.validatePaidProposal({ distributionId: d.id, bankReference: "REF-1", paidOn: "2999-01-01" })).toThrow(/future/);
    });

    test("a partner reports back once, after it has been paid", async () => {
      const d = await service.create({ counterpartyId: partnerId, category: "fuqara", amount: "30000", reason: "Food parcels for 60 families in Kano." }, officerUserId);
      await expect(service.recordPartnerReport(d.id, { reachedCount: 60, report: "Parcels delivered to 60 families." }, officerUserId)).rejects.toThrow(
        /once the money has been paid/,
      );
      await approve(d.id);
      await markPaid(d.id);

      const reported = await service.recordPartnerReport(d.id, { reachedCount: 58, report: "Parcels delivered to 58 families in Dala." }, officerUserId);
      expect(reported).toMatchObject({ partnerReachedCount: 58, partnerReportedAt: expect.any(Date) });
      await expect(service.recordPartnerReport(d.id, { reachedCount: 58, report: "Second report attempt." }, officerUserId)).rejects.toThrow(
        ConflictException,
      );
    });

    test("summary() reports totals, per-category figures and how long the oldest zakah has waited", async () => {
      const s = await service.summary();
      expect(new Prisma.Decimal(s.available).equals(new Prisma.Decimal(s.received).minus(s.committed))).toBe(true);
      expect(s.byCategory.some((c) => c.category === "gharimin" && c.status === "paid")).toBe(true);
      expect(s.oldestUndistributedSince === null || s.oldestUndistributedSince instanceof Date).toBe(true);
    });
  });

  // Straight to the database: these prove it enforces the rules itself.
  describe("database rules", () => {
    let distributionId: string;
    let recipientId: string;

    beforeAll(async () => {
      recipientId = (await recipient()).id;
      distributionId = (
        await service.create({ recipientId, category: "fuqara", amount: "1000", reason: "Food for the month." }, officerUserId)
      ).id;
    });

    test("the administrators' category can never be paid", async () => {
      await expect(
        prisma.zakahDistribution.create({
          data: { recipientId, category: "amilin", amount: "1", currency: "NGN", reason: "x", createdByUserId: officerUserId },
        }),
      ).rejects.toThrow();
    });

    test("a distribution has exactly one payee", async () => {
      await expect(
        prisma.zakahDistribution.create({
          data: { recipientId, counterpartyId: partnerId, category: "fuqara", amount: "1", currency: "NGN", reason: "x", createdByUserId: officerUserId },
        }),
      ).rejects.toThrow();
    });

    test("its amount and category never change, it's never deleted, and status can't skip approval", async () => {
      await expect(prisma.zakahDistribution.update({ where: { id: distributionId }, data: { amount: "999999" } })).rejects.toThrow(/never change/);
      await expect(prisma.zakahDistribution.update({ where: { id: distributionId }, data: { category: "gharimin" } })).rejects.toThrow(/never change/);
      await expect(prisma.zakahDistribution.delete({ where: { id: distributionId } })).rejects.toThrow(/never deleted/);
      await expect(
        prisma.zakahDistribution.update({
          where: { id: distributionId },
          data: { status: "paid", bankReference: "X", paidOn: new Date(), paymentActionId: (await governedAction("zakah.distribution_mark_paid", {})).id },
        }),
      ).rejects.toThrow(/can't go from pending_approval to paid/);
    });

    test("a recipient is never deleted", async () => {
      await expect(prisma.zakahRecipient.delete({ where: { id: recipientId } })).rejects.toThrow(/never deleted/);
    });
  });
});

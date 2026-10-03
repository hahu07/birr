import { prisma } from "@birr/db";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { BeneficiariesService, MAX_UNSCOPED_LIST_ROWS } from "./beneficiaries.service";
import { EncryptionService } from "../../common/settings/encryption.service";

function uniquePhone(): string {
  return `0${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-11);
}

describe("BeneficiariesService", () => {
  const service = new BeneficiariesService(new EncryptionService());

  const waqfIds: string[] = [];
  const waqfCauseIds: string[] = [];
  const beneficiaryIds: string[] = [];

  let waqfAId: string;
  let waqfBId: string;
  let causeOnWaqfAId: string;
  let causeOnWaqfBId: string;
  let actorUserId: string;

  beforeAll(async () => {
    // SETTINGS_ENCRYPTION_KEY must be set for any test exercising
    // bankDetails — same requirement as encryption.service.spec.ts's
    // own fixture setup.
    if (!process.env.SETTINGS_ENCRYPTION_KEY) {
      process.env.SETTINGS_ENCRYPTION_KEY = "0".repeat(64);
    }

    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `beneficiaries-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const foundation = await prisma.foundation.create({
      data: { name: "Beneficiaries Fixture Foundation" },
    });

    const waqfA = await prisma.waqf.create({
      data: { name: "Beneficiaries Fixture Waqf A", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfAId = waqfA.id;
    waqfIds.push(waqfA.id);

    const waqfB = await prisma.waqf.create({
      data: { name: "Beneficiaries Fixture Waqf B", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfBId = waqfB.id;
    waqfIds.push(waqfB.id);

    const causeOnA = await prisma.waqfCause.create({
      data: { waqfId: waqfAId, name: "Cause On Waqf A" },
    });
    causeOnWaqfAId = causeOnA.id;
    waqfCauseIds.push(causeOnA.id);

    const causeOnB = await prisma.waqfCause.create({
      data: { waqfId: waqfBId, name: "Cause On Waqf B" },
    });
    causeOnWaqfBId = causeOnB.id;
    waqfCauseIds.push(causeOnB.id);
  });

  afterAll(async () => {
    // WaqfCaseAssignment rows created by the caseload-scoping tests below
    // must go before the waqfs they reference (no cascade delete anywhere
    // in this schema — see CLAUDE.md's soft-delete-only rule).
    await prisma.waqfCaseAssignment.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
    await prisma.waqfCause.deleteMany({ where: { id: { in: waqfCauseIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("create() succeeds when causeId belongs to the same waqf", async () => {
    const beneficiary = await service.create(
      {
        waqfId: waqfAId,
        causeId: causeOnWaqfAId,
        name: "Fixture Beneficiary With Cause",
        eligibilityCriteria: "Fixture criteria",
      },
      actorUserId,
    );
    beneficiaryIds.push(beneficiary.id);
    expect(beneficiary.causeId).toBe(causeOnWaqfAId);
  });

  test("create() rejects a causeId that belongs to a different waqf", async () => {
    await expect(
      service.create(
        {
          waqfId: waqfAId,
          causeId: causeOnWaqfBId,
          name: "Should Not Be Created",
          eligibilityCriteria: "Fixture criteria",
        },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() rejects an unknown causeId — causeId is required going forward", async () => {
    await expect(
      service.create(
        {
          waqfId: waqfAId,
          causeId: "00000000-0000-0000-0000-000000000000",
          name: "Should Not Be Created",
          eligibilityCriteria: "Fixture criteria",
        },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() writes a matching audit_logs record", async () => {
    const beneficiary = await service.create(
      {
        waqfId: waqfAId,
        causeId: causeOnWaqfAId,
        name: "Fixture Beneficiary For Audit Check",
        eligibilityCriteria: "Fixture criteria",
      },
      actorUserId,
    );
    beneficiaryIds.push(beneficiary.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: beneficiary.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "Beneficiary",
      action: "beneficiary.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });

  test("create() defaults kind to individual", async () => {
    const beneficiary = await service.create(
      {
        waqfId: waqfAId,
        causeId: causeOnWaqfAId,
        name: "Fixture Individual Beneficiary",
        eligibilityCriteria: "Fixture criteria",
      },
      actorUserId,
    );
    beneficiaryIds.push(beneficiary.id);
    expect(beneficiary.kind).toBe("individual");
  });

  test("create() stores an organization beneficiary", async () => {
    const beneficiary = await service.create(
      {
        waqfId: waqfAId,
        causeId: causeOnWaqfAId,
        kind: "organization",
        name: "Fixture Orphanage",
        eligibilityCriteria: "Registered orphanage in jurisdiction",
      },
      actorUserId,
    );
    beneficiaryIds.push(beneficiary.id);
    expect(beneficiary.kind).toBe("organization");
  });

  test("create() encrypts bank details at rest and decrypts them back on a staff-facing read", async () => {
    const bankDetails = { bankName: "Fixture Bank", accountNumber: "0123456789", accountName: "Fixture Beneficiary" };
    const beneficiary = await service.create(
      {
        waqfId: waqfAId,
        causeId: causeOnWaqfAId,
        name: "Fixture Beneficiary With Bank Details",
        eligibilityCriteria: "Fixture criteria",
        bankDetails,
      },
      actorUserId,
    );
    beneficiaryIds.push(beneficiary.id);

    // Stored value is genuinely not the plaintext JSON.
    const raw = await prisma.beneficiary.findUnique({ where: { id: beneficiary.id } });
    expect(raw!.bankDetailsEncrypted).not.toBeNull();
    expect(raw!.bankDetailsEncrypted).not.toContain("0123456789");

    // findById() itself stays raw (internal-safe) — decryption happens
    // only via the explicit withDecryptedBankDetails() call the
    // controller makes for actual staff display.
    const rawRead = await service.findById(beneficiary.id);
    expect(rawRead!.bankDetailsEncrypted).not.toBeNull();
    const decrypted = service.withDecryptedBankDetails(rawRead!);
    expect(decrypted.bankDetails).toEqual(bankDetails);
    expect((decrypted as any).bankDetailsEncrypted).toBeUndefined();
  });

  test("create() never writes bankDetailsEncrypted into the audit_logs snapshot", async () => {
    const beneficiary = await service.create(
      {
        waqfId: waqfAId,
        causeId: causeOnWaqfAId,
        name: "Fixture Beneficiary For Audit PII Check",
        eligibilityCriteria: "Fixture criteria",
        bankDetails: { bankName: "Fixture Bank", accountNumber: "9999999999", accountName: "Someone" },
      },
      actorUserId,
    );
    beneficiaryIds.push(beneficiary.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: beneficiary.id, action: "beneficiary.created" } });
    expect(logs).toHaveLength(1);
    expect((logs[0]!.after as any).bankDetailsEncrypted).toBeUndefined();
  });

  describe("setPayoutDetails()", () => {
    test("registers payout details on a beneficiary that had none, decryptable back on a staff-facing read", async () => {
      const beneficiary = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "No Payout Details Yet", eligibilityCriteria: "Fixture" },
        actorUserId,
      );
      beneficiaryIds.push(beneficiary.id);
      expect(beneficiary.payoutProvider).toBeNull();

      const updated = await service.setPayoutDetails(
        beneficiary.id,
        {
          payoutProvider: "paystack",
          bankDetails: { bankName: "GTBank", accountNumber: "0123456789", accountName: "No Payout Details Yet", bankCode: "058" },
        },
        actorUserId,
      );
      expect(updated.payoutProvider).toBe("paystack");

      const read = service.withDecryptedBankDetails(updated);
      expect(read.bankDetails).toEqual({
        bankName: "GTBank",
        accountNumber: "0123456789",
        accountName: "No Payout Details Yet",
        bankCode: "058",
      });
    });

    test("rejects an unknown beneficiary id", async () => {
      await expect(
        service.setPayoutDetails(
          "00000000-0000-0000-0000-000000000000",
          { payoutProvider: "paystack", bankDetails: { bankName: "Bank", accountNumber: "1", accountName: "A", bankCode: "058" } },
          actorUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    test("writes a beneficiary.payout_details_set audit log excluding bankDetailsEncrypted from both before/after snapshots", async () => {
      const beneficiary = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "Payout Details Audit Check", eligibilityCriteria: "Fixture" },
        actorUserId,
      );
      beneficiaryIds.push(beneficiary.id);

      await service.setPayoutDetails(
        beneficiary.id,
        {
          payoutProvider: "paystack",
          bankDetails: { bankName: "Bank", accountNumber: "1", accountName: "A", bankCode: "058" },
        },
        actorUserId,
      );

      const logs = await prisma.auditLog.findMany({
        where: { entityId: beneficiary.id, action: "beneficiary.payout_details_set" },
      });
      expect(logs).toHaveLength(1);
      expect((logs[0]!.before as any).bankDetailsEncrypted).toBeUndefined();
      expect((logs[0]!.after as any).bankDetailsEncrypted).toBeUndefined();
    });
  });

  describe("assertStaffCanAccessWaqf() / list() caseload scoping", () => {
    // 2026-09-08 audit fix regression coverage: a staff member with no
    // relation to a waqf used to be able to pull its beneficiaries'
    // decrypted bank details with no check at all.
    test("rejects a staff member with no active case assignment on the waqf", async () => {
      const unassignedUser = await prisma.user.create({
        data: { email: `beneficiaries-unassigned-${Date.now()}@example.com`, fullName: "Unassigned Staff" },
      });
      const unassignedStaff = await prisma.birrStaff.create({
        data: { userId: unassignedUser.id, staffRole: "external_auditor" },
      });
      await expect(
        service.assertStaffCanAccessWaqf(waqfAId, { id: unassignedStaff.id, staffRole: unassignedStaff.staffRole }),
      ).rejects.toThrow(ForbiddenException);
    });

    test("allows a staff member with an active case assignment on the waqf", async () => {
      const assignedUser = await prisma.user.create({
        data: { email: `beneficiaries-assigned-${Date.now()}@example.com`, fullName: "Assigned Staff" },
      });
      const assignedStaff = await prisma.birrStaff.create({
        data: { userId: assignedUser.id, staffRole: "mutawalli_officer" },
      });
      await prisma.waqfCaseAssignment.create({
        data: { waqfId: waqfAId, birrStaffId: assignedStaff.id, assignmentRole: "mutawalli_officer" },
      });
      await expect(
        service.assertStaffCanAccessWaqf(waqfAId, { id: assignedStaff.id, staffRole: assignedStaff.staffRole }),
      ).resolves.toBeUndefined();
    });

    test("always allows platform_admin, with no case assignment needed", async () => {
      await expect(
        service.assertStaffCanAccessWaqf(waqfAId, { id: "irrelevant-id", staffRole: "platform_admin" }),
      ).resolves.toBeUndefined();
    });

    test("list() with no waqfId scopes to the caller's own active caseload, not every waqf firm-wide", async () => {
      const caseloadUser = await prisma.user.create({
        data: { email: `beneficiaries-caseload-${Date.now()}@example.com`, fullName: "Caseload Staff" },
      });
      const caseloadStaff = await prisma.birrStaff.create({
        data: { userId: caseloadUser.id, staffRole: "mutawalli_officer" },
      });
      await prisma.waqfCaseAssignment.create({
        data: { waqfId: waqfAId, birrStaffId: caseloadStaff.id, assignmentRole: "mutawalli_officer" },
      });

      const onA = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "Caseload Scoping — On A", eligibilityCriteria: "Fixture" },
        actorUserId,
      );
      beneficiaryIds.push(onA.id);
      const onB = await service.create(
        { waqfId: waqfBId, causeId: causeOnWaqfBId, name: "Caseload Scoping — On B", eligibilityCriteria: "Fixture" },
        actorUserId,
      );
      beneficiaryIds.push(onB.id);

      const results = await service.list(undefined, { id: caseloadStaff.id, staffRole: caseloadStaff.staffRole });
      const resultIds = results.map((b) => b.id);
      expect(resultIds).toContain(onA.id);
      expect(resultIds).not.toContain(onB.id);
    });

    // 2026-09-14 audit fix: list() with no waqfId previously ran an
    // unbounded findMany on both the platform_admin and caseload
    // branches, and the controller decrypts bank details on every
    // returned row — an unfiltered call was returning every
    // beneficiary's decrypted bank account details, platform-wide, in
    // one response. Asserted via a findMany spy, not by actually
    // creating MAX_UNSCOPED_LIST_ROWS+1 fixture rows.
    test("list() with no waqfId caps both the platform_admin and caseload branches at MAX_UNSCOPED_LIST_ROWS", async () => {
      const findManySpy = jest.spyOn(prisma.beneficiary, "findMany");
      try {
        await service.list(undefined, { id: "irrelevant-id", staffRole: "platform_admin" });
        expect(findManySpy).toHaveBeenLastCalledWith(expect.objectContaining({ take: MAX_UNSCOPED_LIST_ROWS }));

        await service.list(undefined, { id: "irrelevant-id", staffRole: "mutawalli_officer" });
        expect(findManySpy).toHaveBeenLastCalledWith(expect.objectContaining({ take: MAX_UNSCOPED_LIST_ROWS }));
      } finally {
        findManySpy.mockRestore();
      }
    });
  });

  describe("findPossibleDuplicates()", () => {
    const nominationIds: string[] = [];
    let dupFounderId: string;
    let dupFounderUserId: string;

    beforeAll(async () => {
      const founderUser = await prisma.user.create({
        data: { email: `beneficiaries-dup-founder-${Date.now()}@example.com`, fullName: "Test Founder User" },
      });
      dupFounderUserId = founderUser.id;
      const founder = await prisma.founder.create({ data: { name: "Beneficiaries Dup Fixture Founder", kind: "institution" } });
      dupFounderId = founder.id;
    });

    afterAll(async () => {
      await prisma.beneficiaryNomination.deleteMany({ where: { id: { in: nominationIds } } });
    });

    test("flags two beneficiaries in different waqfs sharing a normalized phone number", async () => {
      const digits = uniquePhone();
      const a = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "Dup Fixture A", eligibilityCriteria: "n/a", phone: digits },
        actorUserId,
      );
      beneficiaryIds.push(a.id);
      const b = await service.create(
        {
          waqfId: waqfBId,
          causeId: causeOnWaqfBId,
          name: "Dup Fixture B",
          eligibilityCriteria: "n/a",
          // Same digits, different punctuation — proves normalization
          // works, not just a literal string match.
          phone: `(${digits.slice(0, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`,
        },
        actorUserId,
      );
      beneficiaryIds.push(b.id);

      const duplicates = await service.findPossibleDuplicates();
      const aEntry = duplicates.find((d) => d.id === a.id);
      const bEntry = duplicates.find((d) => d.id === b.id);
      expect(aEntry?.matchedWith).toEqual([{ id: b.id, type: "beneficiary" }]);
      expect(bEntry?.matchedWith).toEqual([{ id: a.id, type: "beneficiary" }]);
    });

    test("flags a pending nomination sharing an email with an existing beneficiary", async () => {
      const email = `dup-fixture-${Date.now()}@example.com`;
      const beneficiary = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "Dup Fixture Email Beneficiary", eligibilityCriteria: "n/a", email: email.toUpperCase() },
        actorUserId,
      );
      beneficiaryIds.push(beneficiary.id);

      const nomination = await prisma.beneficiaryNomination.create({
        data: {
          waqfId: waqfAId,
          proposedByFounderId: dupFounderId,
          proposedByUserId: dupFounderUserId,
          causeId: causeOnWaqfAId,
          name: "Dup Fixture Nomination",
          eligibilityCriteria: "n/a",
          email,
          status: "pending",
        },
      });
      nominationIds.push(nomination.id);

      const duplicates = await service.findPossibleDuplicates();
      const beneficiaryEntry = duplicates.find((d) => d.id === beneficiary.id);
      expect(beneficiaryEntry?.matchedWith).toEqual([{ id: nomination.id, type: "nomination" }]);
    });

    test("does not flag two beneficiaries with no shared phone/email", async () => {
      const a = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "No Dup A", eligibilityCriteria: "n/a", phone: uniquePhone() },
        actorUserId,
      );
      beneficiaryIds.push(a.id);
      const b = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "No Dup B", eligibilityCriteria: "n/a", phone: uniquePhone() },
        actorUserId,
      );
      beneficiaryIds.push(b.id);

      const duplicates = await service.findPossibleDuplicates();
      expect(duplicates.some((d) => d.id === a.id || d.id === b.id)).toBe(false);
    });

    test("excludes an approved/rejected nomination from matching", async () => {
      const digits = uniquePhone();
      const beneficiary = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "Resolved Nomination Beneficiary", eligibilityCriteria: "n/a", phone: digits },
        actorUserId,
      );
      beneficiaryIds.push(beneficiary.id);

      const nomination = await prisma.beneficiaryNomination.create({
        data: {
          waqfId: waqfAId,
          proposedByFounderId: dupFounderId,
          proposedByUserId: dupFounderUserId,
          causeId: causeOnWaqfAId,
          name: "Resolved Nomination",
          eligibilityCriteria: "n/a",
          phone: digits,
          status: "rejected",
        },
      });
      nominationIds.push(nomination.id);

      const duplicates = await service.findPossibleDuplicates();
      const beneficiaryEntry = duplicates.find((d) => d.id === beneficiary.id);
      expect(beneficiaryEntry).toBeUndefined();
    });
  });

  describe("listEligibilityIssues()", () => {
    test("flags an inactive beneficiary", async () => {
      const beneficiary = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "Inactive Fixture", eligibilityCriteria: "n/a" },
        actorUserId,
      );
      beneficiaryIds.push(beneficiary.id);
      await prisma.beneficiary.update({ where: { id: beneficiary.id }, data: { status: "inactive" } });

      const issues = await service.listEligibilityIssues();
      const entry = issues.find((i) => i.beneficiaryId === beneficiary.id);
      expect(entry?.issues).toEqual(["inactive"]);
    });

    test("flags an active beneficiary with a past eligibilityExpiresAt", async () => {
      const beneficiary = await service.create(
        {
          waqfId: waqfAId,
          causeId: causeOnWaqfAId,
          name: "Expired Fixture",
          eligibilityCriteria: "n/a",
          eligibilityExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
        actorUserId,
      );
      beneficiaryIds.push(beneficiary.id);

      const issues = await service.listEligibilityIssues();
      const entry = issues.find((i) => i.beneficiaryId === beneficiary.id);
      expect(entry?.issues).toEqual(["eligibility_expired"]);
    });

    test("excludes a healthy active beneficiary with no expiry from the result", async () => {
      const beneficiary = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "Healthy Fixture", eligibilityCriteria: "n/a" },
        actorUserId,
      );
      beneficiaryIds.push(beneficiary.id);

      const issues = await service.listEligibilityIssues();
      expect(issues.find((i) => i.beneficiaryId === beneficiary.id)).toBeUndefined();
    });
  });

  // No coverage existed for this method at all before this — a real gap
  // given it's the one Founder-reachable beneficiary read
  // (BeneficiariesController.summary(), @Public() + resolveFounderFromSession,
  // no staff fallback) and its own comment flags a 2026-09-29 reversal
  // from aggregate-only to including real per-beneficiary records —
  // exactly the kind of change that risks silently widening what crosses
  // the Founder Portal boundary. Found during the comprehensive review's
  // §5 PII-boundary pass.
  describe("summaryForFounder()", () => {
    let founderAId: string;
    let founderBId: string;

    beforeAll(async () => {
      // Founder/User fixtures not cleaned up in afterAll — same
      // reasoning as every other spec in this codebase.
      const founderA = await prisma.founder.create({ data: { name: "Summary Fixture Founder A", kind: "institution" } });
      founderAId = founderA.id;
      await prisma.foundationFounder.create({ data: { foundationId: (await prisma.waqf.findUniqueOrThrow({ where: { id: waqfAId } })).foundationId, founderId: founderAId } });

      const founderB = await prisma.founder.create({ data: { name: "Summary Fixture Founder B (unrelated)", kind: "institution" } });
      founderBId = founderB.id;
    });

    test("never includes bank/payout details, even for a beneficiary that has them on file", async () => {
      const beneficiary = await service.create(
        { waqfId: waqfAId, causeId: causeOnWaqfAId, name: "Summary Fixture Beneficiary", eligibilityCriteria: "Fixture" },
        actorUserId,
      );
      beneficiaryIds.push(beneficiary.id);
      await service.setPayoutDetails(
        beneficiary.id,
        { payoutProvider: "paystack", bankDetails: { bankName: "GTBank", accountNumber: "0123456789", accountName: "Summary Fixture Beneficiary" } },
        actorUserId,
      );

      const summary = await service.summaryForFounder(waqfAId, founderAId);
      expect(summary).not.toBeNull();
      const entry = summary!.beneficiaries.find((b) => b.id === beneficiary.id);
      expect(entry).toBeDefined();
      expect(entry).not.toHaveProperty("bankDetailsEncrypted");
      expect(entry).not.toHaveProperty("bankDetails");
      expect(entry).not.toHaveProperty("payoutProvider");
      expect(JSON.stringify(summary)).not.toContain("0123456789");
      expect(JSON.stringify(summary)).not.toContain("GTBank");
    });

    test("returns null for a waqf that isn't the calling Founder's — an unrelated Founder can't enumerate it by id", async () => {
      const summary = await service.summaryForFounder(waqfAId, founderBId);
      expect(summary).toBeNull();
    });

    test("byStatus/byCause aggregates match the actual beneficiaries returned", async () => {
      const summary = await service.summaryForFounder(waqfAId, founderAId);
      expect(summary).not.toBeNull();
      const activeCount = summary!.beneficiaries.filter((b) => b.status === "active").length;
      expect(summary!.byStatus.active).toBe(activeCount);
      expect(summary!.total).toBe(summary!.beneficiaries.length);
    });
  });
});

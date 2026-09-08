import { prisma } from "@birr/db";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { BeneficiariesService } from "./beneficiaries.service";
import { EncryptionService } from "../../common/settings/encryption.service";

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
  });
});

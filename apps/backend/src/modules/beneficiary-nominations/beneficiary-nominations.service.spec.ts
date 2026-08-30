import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { BeneficiaryNominationsService } from "./beneficiary-nominations.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import { EncryptionService } from "../../common/settings/encryption.service";

describe("BeneficiaryNominationsService", () => {
  const service = new BeneficiaryNominationsService(createFakeNotificationsService(), new EncryptionService());

  const nominationIds: string[] = [];
  const beneficiaryIds: string[] = [];
  const waqfCauseIds: string[] = [];
  const waqfIds: string[] = [];

  let waqfId: string;
  let founderId: string;
  let founderUserId: string;
  let otherFounderId: string;
  let staffUserId: string;
  let causeId: string;

  beforeAll(async () => {
    if (!process.env.SETTINGS_ENCRYPTION_KEY) {
      process.env.SETTINGS_ENCRYPTION_KEY = "0".repeat(64);
    }

    // Fixture User/BirrStaff/Founder not cleaned up in afterAll — same
    // reasoning as other spec files (referenced via audit_logs, which is
    // insert-only at the DB role level).
    const staffUser = await prisma.user.create({
      data: { email: `beneficiary-nominations-staff-${Date.now()}@example.com`, fullName: "Test Staff" },
    });
    staffUserId = staffUser.id;
    await prisma.birrStaff.create({ data: { userId: staffUser.id, staffRole: "mutawalli_officer" } });

    const founderUser = await prisma.user.create({
      data: { email: `beneficiary-nominations-founder-${Date.now()}@example.com`, fullName: "Test Founder User" },
    });
    founderUserId = founderUser.id;

    const founder = await prisma.founder.create({ data: { name: "Beneficiary Nominations Fixture Founder", kind: "institution" } });
    founderId = founder.id;

    const otherFounder = await prisma.founder.create({ data: { name: "Beneficiary Nominations Other Founder", kind: "institution" } });
    otherFounderId = otherFounder.id;

    const foundation = await prisma.foundation.create({ data: { name: "Beneficiary Nominations Fixture Foundation" } });
    await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId } });

    const waqf = await prisma.waqf.create({
      data: { name: "Beneficiary Nominations Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);

    const cause = await prisma.waqfCause.create({ data: { waqfId, name: "Fixture Cause" } });
    causeId = cause.id;
    waqfCauseIds.push(cause.id);
  });

  afterAll(async () => {
    await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
    await prisma.beneficiaryNomination.deleteMany({ where: { id: { in: nominationIds } } });
    await prisma.waqfCause.deleteMany({ where: { id: { in: waqfCauseIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("propose() creates a pending nomination and audit-logs it against the calling founder_user", async () => {
    const nomination = await service.propose(
      { waqfId, causeId, name: "Ahmad Bello", eligibilityCriteria: "Orphaned, under 18" },
      founderId,
      founderUserId,
    );
    nominationIds.push(nomination.id);

    expect(nomination.status).toBe("pending");
    expect(nomination.kind).toBe("individual");

    const logs = await prisma.auditLog.findMany({
      where: { entityId: nomination.id, action: "beneficiary_nomination.proposed" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "founder_user", actorUserId: founderUserId, actorFounderId: founderId });
  });

  test("propose() rejects a waqf that isn't the founder's", async () => {
    await expect(
      service.propose({ waqfId, causeId, name: "Someone", eligibilityCriteria: "N/A" }, otherFounderId, founderUserId),
    ).rejects.toThrow(BadRequestException);
  });

  test("propose() rejects a causeId belonging to a different waqf", async () => {
    const otherFoundation = await prisma.foundation.create({ data: { name: "Beneficiary Nominations Other Foundation" } });
    const otherWaqf = await prisma.waqf.create({
      data: { name: "Beneficiary Nominations Other Waqf", type: "asset", jurisdiction: "AE", foundationId: otherFoundation.id },
    });
    waqfIds.push(otherWaqf.id);
    const otherCause = await prisma.waqfCause.create({ data: { waqfId: otherWaqf.id, name: "Other Waqf's Cause" } });
    waqfCauseIds.push(otherCause.id);

    await expect(
      service.propose(
        { waqfId, causeId: otherCause.id, name: "Someone", eligibilityCriteria: "N/A" },
        founderId,
        founderUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("propose() rejects an unknown causeId — causeId is required going forward", async () => {
    await expect(
      service.propose(
        { waqfId, causeId: "00000000-0000-0000-0000-000000000000", name: "Someone", eligibilityCriteria: "N/A" },
        founderId,
        founderUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("approve() creates a real Beneficiary, links it, and writes both audit rows", async () => {
    const nomination = await service.propose(
      { waqfId, causeId, name: "Fatima Yusuf", eligibilityCriteria: "Widowed, no income" },
      founderId,
      founderUserId,
    );
    nominationIds.push(nomination.id);

    const reviewed = await service.approve(nomination.id, staffUserId);
    expect(reviewed.status).toBe("approved");
    expect(reviewed.resultingBeneficiaryId).toBeTruthy();
    beneficiaryIds.push(reviewed.resultingBeneficiaryId!);

    const beneficiary = await prisma.beneficiary.findUnique({ where: { id: reviewed.resultingBeneficiaryId! } });
    expect(beneficiary).toMatchObject({ waqfId, causeId, name: "Fatima Yusuf", eligibilityCriteria: "Widowed, no income" });

    const nominationLogs = await prisma.auditLog.findMany({
      where: { entityId: nomination.id, action: "beneficiary_nomination.approved" },
    });
    expect(nominationLogs).toHaveLength(1);
    expect(nominationLogs[0]).toMatchObject({ actorType: "birr_staff", actorUserId: staffUserId });

    const beneficiaryLogs = await prisma.auditLog.findMany({
      where: { entityId: reviewed.resultingBeneficiaryId!, action: "beneficiary.created" },
    });
    expect(beneficiaryLogs).toHaveLength(1);
    expect(beneficiaryLogs[0]).toMatchObject({ actorType: "birr_staff", actorUserId: staffUserId });
  });

  test("approve() carries kind, phone, email, and bank details from the nomination onto the resulting Beneficiary", async () => {
    const bankDetails = { bankName: "Fixture Bank", accountNumber: "1112223333", accountName: "Fixture Orphanage" };
    const nomination = await service.propose(
      {
        waqfId,
        causeId,
        name: "Fixture Orphanage",
        kind: "organization",
        eligibilityCriteria: "Registered orphanage",
        phone: "+234800000000",
        email: "contact@fixture-orphanage.example",
        bankDetails,
      },
      founderId,
      founderUserId,
    );
    nominationIds.push(nomination.id);
    expect(nomination.bankDetailsEncrypted).not.toBeNull();
    expect(nomination.bankDetailsEncrypted).not.toContain("1112223333");

    const reviewed = await service.approve(nomination.id, staffUserId);
    beneficiaryIds.push(reviewed.resultingBeneficiaryId!);

    const beneficiary = await prisma.beneficiary.findUnique({ where: { id: reviewed.resultingBeneficiaryId! } });
    expect(beneficiary).toMatchObject({
      kind: "organization",
      phone: "+234800000000",
      email: "contact@fixture-orphanage.example",
    });
    expect(beneficiary!.bankDetailsEncrypted).toBe(nomination.bankDetailsEncrypted);

    // Neither audit row leaks the ciphertext.
    const nominationLog = await prisma.auditLog.findFirst({
      where: { entityId: nomination.id, action: "beneficiary_nomination.approved" },
    });
    expect((nominationLog!.after as any).bankDetailsEncrypted).toBeUndefined();
    const beneficiaryLog = await prisma.auditLog.findFirst({
      where: { entityId: reviewed.resultingBeneficiaryId!, action: "beneficiary.created" },
    });
    expect((beneficiaryLog!.after as any).bankDetailsEncrypted).toBeUndefined();
  });

  test("approve() rejects re-reviewing an already-decided nomination", async () => {
    const nomination = await service.propose(
      { waqfId, causeId, name: "Double Review Test", eligibilityCriteria: "N/A" },
      founderId,
      founderUserId,
    );
    nominationIds.push(nomination.id);

    const reviewed = await service.approve(nomination.id, staffUserId);
    beneficiaryIds.push(reviewed.resultingBeneficiaryId!);

    await expect(service.approve(nomination.id, staffUserId)).rejects.toThrow(BadRequestException);
  });

  test("reject() sets status and reviewNotes, creates no Beneficiary, and audit-logs it", async () => {
    const nomination = await service.propose(
      { waqfId, causeId, name: "Rejected Nominee", eligibilityCriteria: "N/A" },
      founderId,
      founderUserId,
    );
    nominationIds.push(nomination.id);

    const reviewed = await service.reject(nomination.id, { reviewNotes: "Insufficient documentation" }, staffUserId);
    expect(reviewed.status).toBe("rejected");
    expect(reviewed.reviewNotes).toBe("Insufficient documentation");
    expect(reviewed.resultingBeneficiaryId).toBeNull();

    const logs = await prisma.auditLog.findMany({
      where: { entityId: nomination.id, action: "beneficiary_nomination.rejected" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId: staffUserId });
  });

  test("reject() rejects an unknown nomination id", async () => {
    await expect(
      service.reject("00000000-0000-0000-0000-000000000000", { reviewNotes: "N/A" }, staffUserId),
    ).rejects.toThrow(NotFoundException);
  });

  test("list() returns every nomination for the waqf regardless of status, decrypted for staff", async () => {
    const all = await service.list(waqfId);
    expect(all.length).toBeGreaterThanOrEqual(nominationIds.length);
    const statuses = new Set(all.map((n) => n.status));
    expect(statuses.has("pending")).toBe(true);
    expect(statuses.has("approved")).toBe(true);
    expect(statuses.has("rejected")).toBe(true);
    expect(all.every((n) => (n as any).bankDetailsEncrypted === undefined)).toBe(true);

    const orgNomination = all.find((n) => n.name === "Fixture Orphanage");
    expect(orgNomination?.bankDetails).toEqual({
      bankName: "Fixture Bank",
      accountNumber: "1112223333",
      accountName: "Fixture Orphanage",
    });
  });

  test("listForFounder() returns only that founder's own nominations, never bank details, empty for another founder", async () => {
    const own = await service.listForFounder(waqfId, founderId);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((n) => n.proposedByFounder.id === founderId)).toBe(true);
    expect(own.every((n) => (n as any).bankDetailsEncrypted === undefined && (n as any).bankDetails === undefined)).toBe(
      true,
    );

    const others = await service.listForFounder(waqfId, otherFounderId);
    expect(others).toHaveLength(0);
  });
});

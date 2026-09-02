import { prisma } from "@birr/db";
import { NotFoundException } from "@nestjs/common";
import { ComplianceReportsService } from "./compliance-reports.service";
import { TrusteeLicensesService } from "../trustee-licenses/trustee-licenses.service";
import { CompliancePolicySetsService } from "../compliance-policy-sets/compliance-policy-sets.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";

describe("ComplianceReportsService", () => {
  const service = new ComplianceReportsService(
    new TrusteeLicensesService(createFakeNotificationsService()),
    new CompliancePolicySetsService(),
  );

  const waqfIds: string[] = [];
  const governedActionIds: string[] = [];

  let requestedByUserId: string;
  let waqfId: string;
  let permissionId: string;

  beforeAll(async () => {
    const requesterUser = await prisma.user.create({
      data: { email: `compliance-requester-${Date.now()}@example.com`, fullName: "Test Requester" },
    });
    requestedByUserId = requesterUser.id;
    await prisma.birrStaff.create({
      data: { userId: requesterUser.id, staffRole: "compliance_officer" },
    });

    // Every Waqf must belong to a Foundation now — this fixture doesn't
    // exercise founder scoping, so no FoundationFounder rows are needed.
    const foundation = await prisma.foundation.create({
      data: { name: "Compliance Report Fixture Foundation" },
    });
    const waqf = await prisma.waqf.create({
      data: {
        name: "Compliance Report Fixture Waqf",
        type: "asset",
        jurisdiction: "AE",
        foundationId: foundation.id,
      },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);

    // Any real governed_actions permission works here — the report just
    // needs a GovernedAction fixture to assemble, not a specific
    // permission's semantics. "waqf.create" was removed from seed data
    // once waqf establishment became self-service (no longer a
    // governed_actions concept at all — see CLAUDE.md), which silently
    // broke this fixture; asset.dispose is a real governed permission.
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: "asset.dispose" },
    });
    permissionId = permission.id;

    // A governed action + a couple of audit log rows against this waqf,
    // to give the report real history to assemble.
    const action = await prisma.governedAction.create({
      data: {
        waqfId,
        permissionId,
        payload: { note: "fixture" },
        makerType: "human",
        makerUserId: requestedByUserId,
        status: "approved",
      },
    });
    governedActionIds.push(action.id);

    await prisma.auditLog.createMany({
      data: [
        {
          waqfId,
          actorType: "birr_staff",
          actorUserId: requestedByUserId,
          action: "governed_action.proposed",
          entityType: "GovernedAction",
          entityId: action.id,
        },
        {
          waqfId,
          actorType: "birr_staff",
          actorUserId: requestedByUserId,
          action: "governed_action.approved",
          entityType: "GovernedAction",
          entityId: action.id,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.governedAction.deleteMany({ where: { id: { in: governedActionIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("generate() assembles the waqf, its governed actions, and its audit logs", async () => {
    const report = await service.generate(waqfId, requestedByUserId);

    expect(report.waqf.id).toBe(waqfId);
    expect(report.governedActions).toHaveLength(1);
    expect(report.governedActions[0]).toMatchObject({ waqfId, status: "approved" });

    // At least the 2 fixture entries, plus the export call's own audit
    // log — but the export's own entry is written *after* the queries
    // that build the report, so it won't appear in this call's results.
    expect(report.auditLogs.length).toBeGreaterThanOrEqual(2);
    expect(report.auditLogs.some((l) => l.action === "governed_action.proposed")).toBe(true);
    expect(report.auditLogs.some((l) => l.action === "governed_action.approved")).toBe(true);

    expect(report.generatedAt).toBeInstanceOf(Date);
  });

  test("generate() writes its own audit log entry for the export", async () => {
    await service.generate(waqfId, requestedByUserId);

    const logs = await prisma.auditLog.findMany({ where: { entityId: waqfId } });
    expect(
      logs.some(
        (l) => l.action === "compliance_report.exported" && l.actorUserId === requestedByUserId,
      ),
    ).toBe(true);
  });

  test("generate() throws NotFoundException for an unknown waqf id", async () => {
    await expect(
      service.generate("00000000-0000-0000-0000-000000000000", requestedByUserId),
    ).rejects.toThrow(NotFoundException);
  });
});

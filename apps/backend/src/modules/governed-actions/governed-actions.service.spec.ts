import { prisma, Waqf, Beneficiary, Investment, Distribution } from "@birr/db";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { GovernedActionsService } from "./governed-actions.service";
import { AssetsService } from "../assets/assets.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { InvestmentsService } from "../investments/investments.service";
import { DistributionsService } from "../distributions/distributions.service";

describe("GovernedActionsService", () => {
  const service = new GovernedActionsService(
    new AssetsService(),
    new BeneficiariesService(),
    new InvestmentsService(),
    new DistributionsService(),
  );

  const governedActionIds: string[] = [];
  const waqfIds: string[] = [];
  const assetIds: string[] = [];
  const beneficiaryIds: string[] = [];
  const investmentIds: string[] = [];
  const distributionIds: string[] = [];
  const waqfCauseIds: string[] = [];

  let makerUserId: string;
  let checkerUserId: string;
  let assetCheckerUserId: string;
  let beneficiaryCheckerUserId: string;
  let investmentMakerUserId: string;
  let distributionCheckerUserId: string;
  let founderId: string;
  let foundationId: string;

  beforeAll(async () => {
    // Reuses the seeded roles/permissions/role_permissions (packages/db/prisma/seed.ts) —
    // mutawalli_officer is the seeded maker for asset.dispose,
    // distribution.approve, and beneficiary.criteria_update;
    // audit_committee is the seeded checker for asset.dispose. These
    // fixture Users/BirrStaff are not cleaned up in afterAll — see the
    // comment there.
    const makerUser = await prisma.user.create({
      data: { email: `maker-${Date.now()}@example.com`, fullName: "Test Maker" },
    });
    makerUserId = makerUser.id;
    await prisma.birrStaff.create({
      data: { userId: makerUser.id, staffRole: "mutawalli_officer" },
    });

    const checkerUser = await prisma.user.create({
      data: { email: `checker-${Date.now()}@example.com`, fullName: "Test Checker" },
    });
    checkerUserId = checkerUser.id;
    await prisma.birrStaff.create({
      data: { userId: checkerUser.id, staffRole: "legal_adviser" },
    });

    const assetCheckerUser = await prisma.user.create({
      data: { email: `asset-checker-${Date.now()}@example.com`, fullName: "Test Asset Checker" },
    });
    assetCheckerUserId = assetCheckerUser.id;
    await prisma.birrStaff.create({
      data: { userId: assetCheckerUser.id, staffRole: "audit_committee" },
    });

    const beneficiaryCheckerUser = await prisma.user.create({
      data: {
        email: `beneficiary-checker-${Date.now()}@example.com`,
        fullName: "Test Beneficiary Checker",
      },
    });
    beneficiaryCheckerUserId = beneficiaryCheckerUser.id;
    await prisma.birrStaff.create({
      data: { userId: beneficiaryCheckerUser.id, staffRole: "shariah_board_member" },
    });

    // investment.change flips the usual pairing: investment_committee is
    // the seeded maker, mutawalli_officer (makerUserId, above) is a
    // seeded checker for it.
    const investmentMakerUser = await prisma.user.create({
      data: {
        email: `investment-maker-${Date.now()}@example.com`,
        fullName: "Test Investment Maker",
      },
    });
    investmentMakerUserId = investmentMakerUser.id;
    await prisma.birrStaff.create({
      data: { userId: investmentMakerUser.id, staffRole: "investment_committee" },
    });

    // distribution.approve's seeded checker — mutawalli_officer
    // (makerUserId, above) is its seeded maker, same pairing as
    // waqf.create.
    const distributionCheckerUser = await prisma.user.create({
      data: {
        email: `distribution-checker-${Date.now()}@example.com`,
        fullName: "Test Distribution Checker",
      },
    });
    distributionCheckerUserId = distributionCheckerUser.id;
    await prisma.birrStaff.create({
      data: { userId: distributionCheckerUser.id, staffRole: "compliance_officer" },
    });

    const founder = await prisma.founder.create({
      data: { name: "Test Founder", kind: "institution" },
    });
    founderId = founder.id;

    // A Waqf's founder relationship is now derived transitively via
    // foundationId -> foundation_founders, not a direct join on Waqf —
    // every waqf.create payload below uses this fixture Foundation
    // instead of founderIds.
    const foundation = await prisma.foundation.create({
      data: { name: "Test Foundation" },
    });
    foundationId = foundation.id;
    await prisma.foundationFounder.create({
      data: { foundationId, founderId },
    });
  });

  afterAll(async () => {
    // audit_logs is insert-only at the DB role level (see
    // packages/db/prisma/migrations/20260731201431_governed_actions_constraints) —
    // the app role cannot DELETE (or UPDATE) it, in tests or anywhere else,
    // by design. GovernedAction/Asset/Beneficiary/Waqf have no incoming FK
    // from audit_logs (entityId there is a plain field, not a relation) so
    // those clean up fine. Users do have one (actorUserId, ON DELETE SET
    // NULL) — deleting a User who appears in the audit trail would
    // require an implicit UPDATE on audit_logs to null it out, which the
    // same revoke blocks. Deliberately not deleting the fixture
    // Users/BirrStaff/Founders/Foundations below; they're identifiable by
    // their timestamped emails/names. FK-safe order: Distribution
    // (RESTRICT on waqfId, beneficiaryId, and causeId) before WaqfCause
    // (RESTRICT on waqfId — must go after Distribution, which restricts
    // deleting it, and before Waqf, which it restricts deleting) before
    // Asset/Beneficiary/Investment (all RESTRICT on waqfId) before the
    // Waqf they all reference.
    await prisma.governedAction.deleteMany({ where: { id: { in: governedActionIds } } });
    await prisma.distribution.deleteMany({ where: { id: { in: distributionIds } } });
    await prisma.waqfCause.deleteMany({ where: { id: { in: waqfCauseIds } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
    await prisma.investment.deleteMany({ where: { id: { in: investmentIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  function auditLogsFor(entityId: string) {
    return prisma.auditLog.findMany({ where: { entityId } });
  }

  test("propose() rejects a permission that does not require maker/checker", async () => {
    await expect(
      service.propose({
        permissionKey: "waqf.view",
        payload: {},
        makerUserId,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("propose() writes the action and a matching audit log", async () => {
    const waqf = await prisma.waqf.create({
      data: { name: "Audit Test Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const asset = await prisma.asset.create({
      data: { waqfId: waqf.id, name: "Audit Test Fixture Building", category: "real_estate", estimatedValue: "1000" },
    });
    assetIds.push(asset.id);

    const action = await service.propose({
      permissionKey: "asset.dispose",
      payload: { assetId: asset.id },
      makerUserId,
    });
    governedActionIds.push(action.id);

    expect(action.status).toBe("proposed");

    const logs = await auditLogsFor(action.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "GovernedAction",
      action: "governed_action.proposed",
      actorUserId: makerUserId,
    });
  });

  test("decide() rejects the proposer approving their own action (app layer)", async () => {
    const waqf = await prisma.waqf.create({
      data: { name: "Self Check Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const asset = await prisma.asset.create({
      data: { waqfId: waqf.id, name: "Self Check Fixture Building", category: "real_estate", estimatedValue: "1000" },
    });
    assetIds.push(asset.id);

    const action = await service.propose({
      permissionKey: "asset.dispose",
      payload: { assetId: asset.id },
      makerUserId,
    });
    governedActionIds.push(action.id);

    await expect(
      service.decide({
        governedActionId: action.id,
        checkerUserId: makerUserId,
        approve: true,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  test("the database itself rejects checker_user_id = maker_user_id, bypassing the service", async () => {
    const waqf = await prisma.waqf.create({
      data: { name: "DB Constraint Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const asset = await prisma.asset.create({
      data: { waqfId: waqf.id, name: "DB Constraint Fixture Building", category: "real_estate", estimatedValue: "1000" },
    });
    assetIds.push(asset.id);

    const action = await service.propose({
      permissionKey: "asset.dispose",
      payload: { assetId: asset.id },
      makerUserId,
    });
    governedActionIds.push(action.id);

    // Bypasses GovernedActionsService.decide()'s app-layer check entirely —
    // this is what actually proves the checker_not_maker DB constraint
    // holds, not just the application code.
    await expect(
      prisma.governedAction.update({
        where: { id: action.id },
        data: { checkerUserId: makerUserId },
      }),
    ).rejects.toThrow();
  });

  test("propose() rejects a permission whose Permission row still exists but has no configured handler (legacy waqf.create)", async () => {
    // waqf.create's Permission row is never deleted — existing
    // governed_actions history still references it by id, and that
    // history is never erased — but its handler was removed once waqf
    // establishment became donor self-service (see waqfs.controller.ts).
    // Without this guard, the stale row would let someone propose a new
    // action that silently no-ops on approval.
    const legacyPermission = await prisma.permission.findUnique({ where: { key: "waqf.create" } });
    if (!legacyPermission) return; // nothing to assert against on a fresh DB that never had it seeded
    await expect(
      service.propose({
        permissionKey: "waqf.create",
        payload: { name: "Should Never Propose", type: "asset", jurisdiction: "AE", foundationId },
        makerUserId,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("reject → status is rejected and the asset is not disposed", async () => {
    const waqf = await prisma.waqf.create({
      data: { name: "Rejected Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const asset = await prisma.asset.create({
      data: { waqfId: waqf.id, name: "Rejected Fixture Building", category: "real_estate", estimatedValue: "1000" },
    });
    assetIds.push(asset.id);

    const action = await service.propose({
      permissionKey: "asset.dispose",
      payload: { assetId: asset.id },
      makerUserId,
    });
    governedActionIds.push(action.id);

    const result = await service.decide({
      governedActionId: action.id,
      checkerUserId: assetCheckerUserId,
      approve: false,
    });

    expect(result.governedAction.status).toBe("rejected");
    expect(result.fulfillment).toBeUndefined();

    const stillActive = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(stillActive?.status).not.toBe("disposed");
  });

  test("asset.dispose: approve → Asset is disposed, waqfId is derived (not client-supplied), both audit-logged", async () => {
    // Fixture setup bypasses governance entirely — a Waqf and Asset must
    // already exist for a disposal to make sense; only the *disposal* is
    // a governed action, not registration (see Asset's schema comment).
    const waqf = await prisma.waqf.create({
      data: { name: "Asset Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const asset = await prisma.asset.create({
      data: {
        waqfId: waqf.id,
        name: "Fixture Building",
        category: "real_estate",
        estimatedValue: "100000",
      },
    });
    assetIds.push(asset.id);

    // Note: ProposeActionInput has no waqfId field at all — it's always
    // derived server-side via the handler map's resolveWaqfId, never
    // trusted from a caller.
    const action = await service.propose({
      permissionKey: "asset.dispose",
      payload: { assetId: asset.id },
      makerUserId,
    });
    governedActionIds.push(action.id);
    expect(action.waqfId).toBe(waqf.id);

    const result = await service.decide({
      governedActionId: action.id,
      checkerUserId: assetCheckerUserId,
      approve: true,
    });

    expect(result.governedAction.status).toBe("approved");
    expect(result.fulfillment?.entityType).toBe("Asset");
    const disposedAsset = result.fulfillment?.after as typeof asset;
    expect(disposedAsset.status).toBe("disposed");
    expect(disposedAsset.disposedAt).not.toBeNull();

    const decisionLogs = await auditLogsFor(action.id);
    expect(decisionLogs.some((l) => l.action === "governed_action.approved")).toBe(true);

    const assetLogs = await auditLogsFor(asset.id);
    expect(assetLogs.some((l) => l.action === "asset.disposed")).toBe(true);
  });

  test("founder_isolation RLS policy: a founder-scoped session only sees its own waqf", async () => {
    const founderA = await prisma.founder.create({
      data: { name: "RLS Founder A", kind: "institution" },
    });
    const founderB = await prisma.founder.create({
      data: { name: "RLS Founder B", kind: "institution" },
    });
    // Each founder gets its own Foundation — the RLS policy now joins
    // through waqfs.foundationId -> foundation_founders, not a direct
    // Waqf<->Founder table.
    const foundationA = await prisma.foundation.create({
      data: { name: "RLS Foundation A" },
    });
    await prisma.foundationFounder.create({
      data: { foundationId: foundationA.id, founderId: founderA.id },
    });
    const foundationB = await prisma.foundation.create({
      data: { name: "RLS Foundation B" },
    });
    await prisma.foundationFounder.create({
      data: { foundationId: foundationB.id, founderId: founderB.id },
    });

    // Fixture creation bypasses governance entirely, same as every other
    // test's Waqf setup in this file — waqf creation itself is donor
    // self-service now (see waqfs.service.spec.ts for that coverage),
    // not something this service proposes/decides. What this test
    // actually verifies is the RLS policy's query-time behavior, which
    // doesn't care how the rows came to exist.
    const waqfA = await prisma.waqf.create({
      data: { name: "RLS Waqf A", type: "asset", jurisdiction: "AE", foundationId: foundationA.id },
    });
    waqfIds.push(waqfA.id);

    const waqfB = await prisma.waqf.create({
      data: { name: "RLS Waqf B", type: "asset", jurisdiction: "AE", foundationId: foundationB.id },
    });
    waqfIds.push(waqfB.id);

    // SET LOCAL doesn't accept bind parameters in Postgres (it's a
    // utility statement, not DML) — set_config() is a regular callable
    // function and does, so use that instead of string-interpolating the
    // session variable.
    const visibleToFounderA = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_founder_id', ${founderA.id}, true)`;
      return tx.waqf.findMany({ where: { id: { in: [waqfA.id, waqfB.id] } } });
    });

    expect(visibleToFounderA.map((w) => w.id)).toEqual([waqfA.id]);
  });

  test("beneficiary.criteria_update: approve → criteria is updated, waqfId is derived, both audit-logged", async () => {
    // Fixture setup bypasses governance entirely — a Waqf and Beneficiary
    // must already exist; only the criteria *change* is a governed
    // action, not registration (see Beneficiary's schema comment, same
    // split as Asset).
    const waqf = await prisma.waqf.create({
      data: { name: "Beneficiary Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const beneficiary = await prisma.beneficiary.create({
      data: {
        waqfId: waqf.id,
        name: "Fixture Beneficiary",
        eligibilityCriteria: "Original criteria",
      },
    });
    beneficiaryIds.push(beneficiary.id);

    const action = await service.propose({
      permissionKey: "beneficiary.criteria_update",
      payload: { beneficiaryId: beneficiary.id, newCriteria: "Updated criteria" },
      makerUserId,
    });
    governedActionIds.push(action.id);
    expect(action.waqfId).toBe(waqf.id);

    const result = await service.decide({
      governedActionId: action.id,
      checkerUserId: beneficiaryCheckerUserId,
      approve: true,
    });

    expect(result.governedAction.status).toBe("approved");
    expect(result.fulfillment?.entityType).toBe("Beneficiary");
    const updated = result.fulfillment?.after as Beneficiary;
    expect(updated.eligibilityCriteria).toBe("Updated criteria");

    const decisionLogs = await auditLogsFor(action.id);
    expect(decisionLogs.some((l) => l.action === "governed_action.approved")).toBe(true);

    const beneficiaryLogs = await auditLogsFor(beneficiary.id);
    expect(beneficiaryLogs.some((l) => l.action === "beneficiary.criteria_updated")).toBe(true);
  });

  test("investment.change: approve → allocation is updated, waqfId is derived, both audit-logged", async () => {
    // Fixture setup bypasses governance entirely — a Waqf and Investment
    // must already exist; only the allocation *change* is a governed
    // action, not registration (see Investment's schema comment, same
    // split as Asset/Beneficiary). Note the maker/checker pairing here is
    // reversed from every other test in this file: investment_committee
    // proposes, mutawalli_officer (the usual maker) checks — matching the
    // seed data exactly (packages/db/prisma/seed.ts).
    const waqf = await prisma.waqf.create({
      data: { name: "Investment Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const investment = await prisma.investment.create({
      data: {
        waqfId: waqf.id,
        name: "Fixture Sukuk Holding",
        instrumentType: "sukuk",
        allocatedAmount: "50000",
      },
    });
    investmentIds.push(investment.id);

    const action = await service.propose({
      permissionKey: "investment.change",
      payload: { investmentId: investment.id, newAllocatedAmount: "75000" },
      makerUserId: investmentMakerUserId,
    });
    governedActionIds.push(action.id);
    expect(action.waqfId).toBe(waqf.id);

    const result = await service.decide({
      governedActionId: action.id,
      checkerUserId: makerUserId, // mutawalli_officer — a seeded checker for investment.change
      approve: true,
    });

    expect(result.governedAction.status).toBe("approved");
    expect(result.fulfillment?.entityType).toBe("Investment");
    const updated = result.fulfillment?.after as Investment;
    expect(updated.allocatedAmount.toString()).toBe("75000");

    const decisionLogs = await auditLogsFor(action.id);
    expect(decisionLogs.some((l) => l.action === "governed_action.approved")).toBe(true);

    const investmentLogs = await auditLogsFor(investment.id);
    expect(investmentLogs.some((l) => l.action === "investment.allocation_changed")).toBe(true);
  });

  test("distribution.approve: approve → status is approved, approvedAt set, waqfId is derived, both audit-logged", async () => {
    // Fixture setup bypasses governance entirely — a Waqf, Beneficiary,
    // and pending Distribution must already exist; only the *approval*
    // is a governed action, not the draft (see Distribution's schema
    // comment, same split as Asset/Beneficiary/Investment). Same
    // maker/checker pairing as waqf.create: mutawalli_officer proposes,
    // compliance_officer approves.
    const waqf = await prisma.waqf.create({
      data: { name: "Distribution Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const beneficiary = await prisma.beneficiary.create({
      data: {
        waqfId: waqf.id,
        name: "Distribution Fixture Beneficiary",
        eligibilityCriteria: "Fixture criteria",
      },
    });
    beneficiaryIds.push(beneficiary.id);
    // Distribution.causeId is required — every payout must be traceable
    // to a specific cause within the fund.
    const cause = await prisma.waqfCause.create({
      data: { waqfId: waqf.id, name: "Distribution Fixture Cause" },
    });
    waqfCauseIds.push(cause.id);
    const distribution = await prisma.distribution.create({
      data: { waqfId: waqf.id, beneficiaryId: beneficiary.id, causeId: cause.id, amount: "500" },
    });
    distributionIds.push(distribution.id);

    const action = await service.propose({
      permissionKey: "distribution.approve",
      payload: { distributionId: distribution.id },
      makerUserId,
    });
    governedActionIds.push(action.id);
    expect(action.waqfId).toBe(waqf.id);

    const result = await service.decide({
      governedActionId: action.id,
      checkerUserId: distributionCheckerUserId,
      approve: true,
    });

    expect(result.governedAction.status).toBe("approved");
    expect(result.fulfillment?.entityType).toBe("Distribution");
    const approved = result.fulfillment?.after as Distribution;
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).not.toBeNull();

    const decisionLogs = await auditLogsFor(action.id);
    expect(decisionLogs.some((l) => l.action === "governed_action.approved")).toBe(true);

    const distributionLogs = await auditLogsFor(distribution.id);
    expect(distributionLogs.some((l) => l.action === "distribution.approved")).toBe(true);
  });

  // proposedFoundation's resolution logic (attachProposedFoundations) is
  // kept in the service even though no NEW waqf.create action can ever
  // be proposed anymore (the guard above prevents it) — it's harmless,
  // inert code that only ever mattered for the handful of legacy
  // waqf.create rows that predate this pivot, and there's nothing left
  // to usefully assert about it going forward beyond "it's null for
  // every action type that can still be proposed," covered below.
  test("proposedFoundation is null for every action type that can still be proposed", async () => {
    const waqf = await prisma.waqf.create({
      data: { name: "Non-Waqf-Create Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const asset = await prisma.asset.create({
      data: { waqfId: waqf.id, name: "Fixture Building", category: "real_estate", estimatedValue: "1000" },
    });
    assetIds.push(asset.id);

    const action = await service.propose({
      permissionKey: "asset.dispose",
      payload: { assetId: asset.id },
      makerUserId,
    });
    governedActionIds.push(action.id);

    const found = await service.findById(action.id);
    expect(found?.proposedFoundation).toBeNull();
  });

  test("list() filters by status and includes the permission", async () => {
    const waqf = await prisma.waqf.create({
      data: { name: "List Test Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const asset = await prisma.asset.create({
      data: { waqfId: waqf.id, name: "List Test Fixture Building", category: "real_estate", estimatedValue: "1000" },
    });
    assetIds.push(asset.id);

    const action = await service.propose({
      permissionKey: "asset.dispose",
      payload: { assetId: asset.id },
      makerUserId,
    });
    governedActionIds.push(action.id);

    const proposed = await service.list({ status: "proposed" });
    expect(proposed.some((a) => a.id === action.id)).toBe(true);
    const found = proposed.find((a) => a.id === action.id)!;
    expect(found.permission.key).toBe("asset.dispose");

    const approved = await service.list({ status: "approved" });
    expect(approved.some((a) => a.id === action.id)).toBe(false);
  });

  test("findById() returns the action with its permission, and null for an unknown id", async () => {
    const waqf = await prisma.waqf.create({
      data: { name: "FindById Test Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const asset = await prisma.asset.create({
      data: {
        waqfId: waqf.id,
        name: "FindById Test Fixture Building",
        category: "real_estate",
        estimatedValue: "1000",
      },
    });
    assetIds.push(asset.id);

    const action = await service.propose({
      permissionKey: "asset.dispose",
      payload: { assetId: asset.id },
      makerUserId,
    });
    governedActionIds.push(action.id);

    const found = await service.findById(action.id);
    expect(found?.permission.key).toBe("asset.dispose");

    const missing = await service.findById("00000000-0000-0000-0000-000000000000");
    expect(missing).toBeNull();
  });
});

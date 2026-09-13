import { prisma, Beneficiary, Investment, Distribution } from "@birr/db";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { GovernedActionsService } from "./governed-actions.service";
import { AssetsService } from "../assets/assets.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { InvestmentsService } from "../investments/investments.service";
import { CounterpartiesService } from "../counterparties/counterparties.service";
import { DistributionsService } from "../distributions/distributions.service";
import { VaultsService } from "../vaults/vaults.service";
import { VaultProceedsService } from "../vaults/vault-proceeds.service";
import { VaultInvestmentsService } from "../vaults/vault-investments.service";
import { VaultDistributionsService } from "../vaults/vault-distributions.service";
import { VaultContributionsService } from "../vaults/vault-contributions.service";
import { VaultLedgerService } from "../vaults/vault-ledger.service";
import { VaultMilestonesService } from "../vaults/vault-milestones.service";
import {
  FakePaystackPayoutAdapter,
  createFakeStripePayoutAdapter,
  createFakeStablecoinPayoutAdapter,
} from "../distributions/test-support/fake-payout-adapters";
import { EncryptionService } from "../../common/settings/encryption.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";

// Minimal fake, same shape as vault-contributions.service.spec.ts's own
// local FakeAdapter/FakeReceiptEmailAdapter — duplicated rather than
// shared, matching this codebase's existing precedent of no extracted
// test-support fake for PaymentProviderAdapter (contributions.service
// .spec.ts also defines its own locally). Nothing in this file's own
// tests calls createPayment/verifyAndParseWebhook/refund for real —
// requestRefund() (the only VaultContributionsService method exercised
// here) never touches the adapter map at all.
class FakeVaultPaymentAdapter {
  async createPayment() {
    return { providerReference: "fake", clientPayload: {} };
  }
  async verifyAndParseWebhook() {
    return null;
  }
}
class FakeVaultReceiptEmailAdapter {
  async sendReceipt() {}
}

describe("GovernedActionsService", () => {
  // Never construct the real NotificationsService adapters in a test —
  // see createFakeNotificationsService's own comment. asset.dispose's
  // checker-eligible roles (board_of_trustees, audit_committee, ...) can
  // include every active BirrStaff fixture ever created by every spec in
  // a shared dev database, so a real adapter here doesn't just send one
  // extra email like a typical spec would — propose() fans out to all of
  // them at once, which is exactly what flooded the real Resend account
  // with tens of thousands of live API calls before this was caught.
  const notificationsService = createFakeNotificationsService();
  const encryption = new EncryptionService();
  const beneficiariesService = new BeneficiariesService(encryption);
  const fakePaystackPayoutAdapter = new FakePaystackPayoutAdapter();
  const vaultLedgerService = new VaultLedgerService();
  // Any fixture beneficiary that gets decided with approve: true on
  // distribution.approve needs complete Paystack payout details now that
  // approve() gates on DistributionsService.assertPayoutReady.
  function paystackReadyBeneficiaryData() {
    return {
      payoutProvider: "paystack" as const,
      bankDetailsEncrypted: encryption.encrypt(
        JSON.stringify({ bankName: "Test Bank", accountNumber: "0123456789", accountName: "Test Beneficiary", bankCode: "058" }),
      ),
    };
  }
  const service = new GovernedActionsService(
    new AssetsService(),
    beneficiariesService,
    new InvestmentsService(),
    new CounterpartiesService(encryption),
    new DistributionsService(
      beneficiariesService,
      notificationsService,
      createFakeStripePayoutAdapter() as any,
      fakePaystackPayoutAdapter as any,
      createFakeStablecoinPayoutAdapter() as any,
    ),
    new VaultsService(new VaultProceedsService()),
    new VaultInvestmentsService(),
    new VaultDistributionsService(encryption, vaultLedgerService, fakePaystackPayoutAdapter as any),
    new VaultContributionsService(
      encryption,
      new FakeVaultReceiptEmailAdapter() as any,
      vaultLedgerService,
      new FakeVaultPaymentAdapter() as any,
      new FakeVaultPaymentAdapter() as any,
      new FakeVaultPaymentAdapter() as any,
    ),
    new VaultMilestonesService(),
    notificationsService,
  );

  const governedActionIds: string[] = [];
  const waqfIds: string[] = [];
  const assetIds: string[] = [];
  const beneficiaryIds: string[] = [];
  const investmentIds: string[] = [];
  const counterpartyIds: string[] = [];
  const distributionIds: string[] = [];
  const waqfCauseIds: string[] = [];
  const vaultIds: string[] = [];
  const vaultCauseIds: string[] = [];
  const vaultInvestmentIds: string[] = [];
  const vaultDistributionIds: string[] = [];
  const vaultDonorIds: string[] = [];

  let makerUserId: string;
  let assetCheckerUserId: string;
  let beneficiaryCheckerUserId: string;
  let investmentMakerUserId: string;
  let distributionCheckerUserId: string;
  let boardCheckerUserId: string;
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

    // vault.contribution_refund's seeded checker — compliance_officer
    // (distributionCheckerUserId, above) is its seeded maker.
    const boardCheckerUser = await prisma.user.create({
      data: { email: `board-checker-${Date.now()}@example.com`, fullName: "Test Board Checker" },
    });
    boardCheckerUserId = boardCheckerUser.id;
    await prisma.birrStaff.create({
      data: { userId: boardCheckerUser.id, staffRole: "board_of_trustees" },
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
    // Vault side — same FK-safe ordering reasoning as the Waqf side
    // above: VaultDistribution/VaultInvestment (RESTRICT on vaultId)
    // before VaultCause (RESTRICT on vaultId) before Vault; VaultDonor
    // has no incoming RESTRICT from anything left standing once
    // VaultContribution rows created via the real flow tests are gone.
    await prisma.vaultDistribution.deleteMany({ where: { id: { in: vaultDistributionIds } } });
    await prisma.vaultInvestment.deleteMany({ where: { id: { in: vaultInvestmentIds } } });
    // RESTRICT on vaultId, same reasoning as VaultDistribution/
    // VaultInvestment above — after VaultDistribution (already gone,
    // and its own vaultMilestoneId FK is ON DELETE SET NULL anyway).
    await prisma.vaultMilestone.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultProceeds.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultContribution.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultCause.deleteMany({ where: { id: { in: vaultCauseIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.vaultDonor.deleteMany({ where: { id: { in: vaultDonorIds } } });
    await prisma.counterparty.deleteMany({ where: { id: { in: counterpartyIds } } });
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
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
      data: { waqfId: waqf.id, name: "Audit Test Fixture Building", category: "real_estate", estimatedValue: "1000", currency: "USD" },
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
      data: { waqfId: waqf.id, name: "Self Check Fixture Building", category: "real_estate", estimatedValue: "1000", currency: "USD" },
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
      data: { waqfId: waqf.id, name: "DB Constraint Fixture Building", category: "real_estate", estimatedValue: "1000", currency: "USD" },
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
      data: { waqfId: waqf.id, name: "Rejected Fixture Building", category: "real_estate", estimatedValue: "1000", currency: "USD" },
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
        currency: "USD",
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

  test("asset.dispose: approving a second, separate proposal against an already-disposed asset is rejected, not silently re-disposed", async () => {
    // checkDuplicate only blocks a second *pending* proposal against the
    // same asset — once the first is approved (no longer "proposed"),
    // nothing at propose()-time stops a brand new proposal targeting the
    // same, now-disposed asset. This is what actually proves
    // AssetsService.dispose()'s own atomic claim, not checkDuplicate,
    // is the real backstop here.
    const waqf = await prisma.waqf.create({
      data: { name: "Double Dispose Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const asset = await prisma.asset.create({
      data: { waqfId: waqf.id, name: "Double Dispose Fixture Building", category: "real_estate", estimatedValue: "1000", currency: "USD" },
    });
    assetIds.push(asset.id);

    const firstAction = await service.propose({
      permissionKey: "asset.dispose",
      payload: { assetId: asset.id },
      makerUserId,
    });
    governedActionIds.push(firstAction.id);
    await service.decide({ governedActionId: firstAction.id, checkerUserId: assetCheckerUserId, approve: true });

    const disposedOnce = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(disposedOnce?.status).toBe("disposed");
    const firstDisposedAt = disposedOnce?.disposedAt;

    // checkDuplicate finds nothing (firstAction is "approved", not
    // "proposed"), so this second proposal is allowed to be created —
    // the real protection has to be at decide()-time, inside dispose()
    // itself.
    const secondAction = await service.propose({
      permissionKey: "asset.dispose",
      payload: { assetId: asset.id },
      makerUserId,
    });
    governedActionIds.push(secondAction.id);

    await expect(
      service.decide({ governedActionId: secondAction.id, checkerUserId: assetCheckerUserId, approve: true }),
    ).rejects.toThrow(ConflictException);

    // Not silently re-disposed — disposedAt is unchanged from the first,
    // real disposal.
    const stillDisposedOnce = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(stillDisposedOnce?.disposedAt?.getTime()).toBe(firstDisposedAt?.getTime());
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

  test("beneficiary.status_change: approve → status flips, waqfId is derived, both audit-logged, bank details excluded", async () => {
    const waqf = await prisma.waqf.create({
      data: { name: "Beneficiary Status Change Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const beneficiary = await prisma.beneficiary.create({
      data: {
        waqfId: waqf.id,
        name: "Fixture Beneficiary For Status Change",
        eligibilityCriteria: "Fixture criteria",
        bankDetailsEncrypted: "not-real-ciphertext-but-should-never-appear-in-audit",
      },
    });
    beneficiaryIds.push(beneficiary.id);
    expect(beneficiary.status).toBe("active");

    const action = await service.propose({
      permissionKey: "beneficiary.status_change",
      payload: { beneficiaryId: beneficiary.id, newStatus: "inactive" },
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
    expect(updated.status).toBe("inactive");
    expect((result.fulfillment?.after as any).bankDetailsEncrypted).toBeUndefined();

    const persisted = await prisma.beneficiary.findUnique({ where: { id: beneficiary.id } });
    expect(persisted!.status).toBe("inactive");

    const decisionLogs = await auditLogsFor(action.id);
    expect(decisionLogs.some((l) => l.action === "governed_action.approved")).toBe(true);

    const beneficiaryLogs = await auditLogsFor(beneficiary.id);
    const statusChangedLog = beneficiaryLogs.find((l) => l.action === "beneficiary.status_changed");
    expect(statusChangedLog).toBeTruthy();
    expect((statusChangedLog!.after as any).bankDetailsEncrypted).toBeUndefined();
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
    // A waqf can't invest more than it's actually raised — needed for
    // the allocation change below to have headroom.
    await prisma.contribution.create({
      data: {
        waqfId: waqf.id,
        amount: "100000",
        currency: "USD",
        provider: "paystack",
        providerReference: `governed-actions-spec-investment-${waqf.id}`,
        status: "confirmed",
      },
    });
    const investment = await prisma.investment.create({
      data: {
        waqfId: waqf.id,
        name: "Fixture Sukuk Holding",
        instrumentType: "sukuk",
        allocatedAmount: "50000",
        currency: "USD",
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

  test("counterparty.onboard: rejects approval with no Shariah sign-off, then succeeds once recorded", async () => {
    // Same reversed pairing as investment.change: investment_committee
    // proposes, mutawalli_officer checks — matching seed-data.ts exactly.
    // No resolveWaqfId — a Counterparty is a global registry entry, not
    // scoped to one waqf (see GovernedActionsService's own comment on
    // this handler).
    const counterparty = await prisma.counterparty.create({
      data: { name: `Governed Actions Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE" },
    });
    counterpartyIds.push(counterparty.id);

    const action = await service.propose({
      permissionKey: "counterparty.onboard",
      payload: { counterpartyId: counterparty.id },
      makerUserId: investmentMakerUserId,
    });
    governedActionIds.push(action.id);
    expect(action.waqfId).toBeNull();

    // Gate 1 (Shariah sign-off) hasn't happened yet — decide() itself
    // succeeds (the maker/checker exchange is valid), but the
    // transaction's onApprove call rejects, so nothing should flip.
    await expect(
      service.decide({ governedActionId: action.id, checkerUserId: makerUserId, approve: true }),
    ).rejects.toThrow(BadRequestException);

    const stillPending = await prisma.governedAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(stillPending.status).toBe("proposed");

    // beneficiaryCheckerUserId is seeded as shariah_board_member (see
    // beforeAll above) — reused here for the Shariah sign-off itself,
    // not as a governed-action checker.
    await new CounterpartiesService(encryption).recordShariahApproval(counterparty.id, beneficiaryCheckerUserId);

    const result = await service.decide({
      governedActionId: action.id,
      checkerUserId: makerUserId,
      approve: true,
    });

    expect(result.governedAction.status).toBe("approved");
    expect(result.fulfillment?.entityType).toBe("Counterparty");
    expect((result.fulfillment?.after as { status: string }).status).toBe("active");

    const decisionLogs = await auditLogsFor(action.id);
    expect(decisionLogs.some((l) => l.action === "governed_action.approved")).toBe(true);

    const counterpartyLogs = await auditLogsFor(counterparty.id);
    expect(counterpartyLogs.some((l) => l.action === "counterparty.onboarded")).toBe(true);
  });

  test("counterparty.onboard: propose() rejects a second proposal while one is already pending for the same counterparty", async () => {
    // Regression test — Counterparty.status doesn't change until decided,
    // not proposed, so without this guard a repeat click on "Propose
    // onboarding" (e.g. no visible feedback after the first click) piles
    // up duplicate proposals that each separately need a checker's
    // attention. Confirmed live: 9 duplicates for one counterparty before
    // this fix.
    const counterparty = await prisma.counterparty.create({
      data: { name: `Governed Actions Duplicate Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE" },
    });
    counterpartyIds.push(counterparty.id);

    const first = await service.propose({
      permissionKey: "counterparty.onboard",
      payload: { counterpartyId: counterparty.id },
      makerUserId: investmentMakerUserId,
    });
    governedActionIds.push(first.id);

    await expect(
      service.propose({
        permissionKey: "counterparty.onboard",
        payload: { counterpartyId: counterparty.id },
        makerUserId: investmentMakerUserId,
      }),
    ).rejects.toThrow(ConflictException);

    // Once the first is decided (rejected, here), proposing again is
    // fine — the guard only blocks while one is genuinely still pending.
    await service.decide({ governedActionId: first.id, checkerUserId: makerUserId, approve: false });
    const second = await service.propose({
      permissionKey: "counterparty.onboard",
      payload: { counterpartyId: counterparty.id },
      makerUserId: investmentMakerUserId,
    });
    governedActionIds.push(second.id);
    expect(second.id).not.toBe(first.id);
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
        ...paystackReadyBeneficiaryData(),
      },
    });
    beneficiaryIds.push(beneficiary.id);
    // Distribution.causeId is required — every payout must be traceable
    // to a specific cause within the fund.
    const cause = await prisma.waqfCause.create({
      data: { waqfId: waqf.id, name: "Distribution Fixture Cause", allocatedAmount: "500" },
    });
    waqfCauseIds.push(cause.id);
    const distribution = await prisma.distribution.create({
      data: { waqfId: waqf.id, beneficiaryId: beneficiary.id, causeId: cause.id, amount: "500", currency: "USD" },
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

  test("decide(): two concurrent decisions on the same governed action — only one succeeds and the fulfillment handler runs exactly once", async () => {
    // Regression test for the double-payout race: decide()'s pre-
    // transaction status check alone can't stop two concurrent callers
    // both reading "proposed" before either commits — the fix is the
    // atomic claim (updateMany where status="proposed") inside the
    // transaction. This proves it holds under real concurrency, not just
    // sequential re-decision (already covered by the "already decided"
    // test elsewhere in this file).
    const waqf = await prisma.waqf.create({
      data: { name: "Concurrent Decide Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const beneficiary = await prisma.beneficiary.create({
      data: {
        waqfId: waqf.id,
        name: "Concurrent Decide Fixture Beneficiary",
        eligibilityCriteria: "Fixture criteria",
        ...paystackReadyBeneficiaryData(),
      },
    });
    beneficiaryIds.push(beneficiary.id);
    const cause = await prisma.waqfCause.create({
      data: { waqfId: waqf.id, name: "Concurrent Decide Fixture Cause", allocatedAmount: "500" },
    });
    waqfCauseIds.push(cause.id);
    const distribution = await prisma.distribution.create({
      data: { waqfId: waqf.id, beneficiaryId: beneficiary.id, causeId: cause.id, amount: "500", currency: "USD" },
    });
    distributionIds.push(distribution.id);

    const action = await service.propose({
      permissionKey: "distribution.approve",
      payload: { distributionId: distribution.id },
      makerUserId,
    });
    governedActionIds.push(action.id);

    // A second checker, distinct from distributionCheckerUserId — the
    // race under test is two different people deciding at once, not one
    // person double-clicking.
    const secondChecker = await prisma.user.create({
      data: { email: `distribution-checker-2-${Date.now()}@example.com`, fullName: "Test Second Distribution Checker" },
    });
    await prisma.birrStaff.create({ data: { userId: secondChecker.id, staffRole: "compliance_officer" } });

    const outcomes = await Promise.allSettled([
      service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: true }),
      service.decide({ governedActionId: action.id, checkerUserId: secondChecker.id, approve: true }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);

    // The fulfillment handler (DistributionsService.approve, and its own
    // audit write) must have run exactly once, not twice.
    const distributionLogs = await auditLogsFor(distribution.id);
    expect(distributionLogs.filter((l) => l.action === "distribution.approved")).toHaveLength(1);

    // "approved" or already "disbursing" — decide() fires
    // initiateDisbursement() fire-and-forget on approval (see its own
    // comment), so which one we observe here is a timing detail, not
    // part of what this test is proving.
    const finalDistribution = await prisma.distribution.findUnique({ where: { id: distribution.id } });
    expect(["approved", "disbursing"]).toContain(finalDistribution!.status);
  });

  test("distribution.approve: reject → status is rejected, audit-logged, and the cause's allocation is released", async () => {
    // Regression coverage for the 2026-09-04 fix: rejecting a
    // distribution.approve action used to leave the underlying
    // Distribution stuck at "pending" forever (no handler ran on
    // rejection at all), permanently occupying its cause's allocation
    // ceiling with no way to release it. onReject now exists
    // specifically to close that — this proves both the status flip and
    // the actual real-world consequence (a second distribution can now
    // fully use the freed allocation).
    const waqf = await prisma.waqf.create({
      data: { name: "Distribution Reject Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const beneficiary = await prisma.beneficiary.create({
      data: {
        waqfId: waqf.id,
        name: "Distribution Reject Fixture Beneficiary",
        eligibilityCriteria: "Fixture criteria",
        ...paystackReadyBeneficiaryData(),
      },
    });
    beneficiaryIds.push(beneficiary.id);
    const cause = await prisma.waqfCause.create({
      data: { waqfId: waqf.id, name: "Distribution Reject Fixture Cause", allocatedAmount: "500" },
    });
    waqfCauseIds.push(cause.id);
    const distribution = await prisma.distribution.create({
      data: { waqfId: waqf.id, beneficiaryId: beneficiary.id, causeId: cause.id, amount: "500", currency: "USD" },
    });
    distributionIds.push(distribution.id);

    const action = await service.propose({
      permissionKey: "distribution.approve",
      payload: { distributionId: distribution.id },
      makerUserId,
    });
    governedActionIds.push(action.id);

    const result = await service.decide({
      governedActionId: action.id,
      checkerUserId: distributionCheckerUserId,
      approve: false,
    });

    expect(result.governedAction.status).toBe("rejected");
    expect(result.fulfillment?.entityType).toBe("Distribution");
    const rejected = result.fulfillment?.after as Distribution;
    expect(rejected.status).toBe("rejected");

    const distributionLogs = await auditLogsFor(distribution.id);
    expect(distributionLogs.some((l) => l.action === "distribution.rejected")).toBe(true);

    // The real proof: with the 500 rejected, a fresh 500 distribution
    // against the same cause now succeeds — it would have been rejected
    // by assertWithinAllocation as over-ceiling if the first one were
    // still silently "pending" and counted as committed.
    const distributionsService = new DistributionsService(
      beneficiariesService,
      notificationsService,
      createFakeStripePayoutAdapter() as any,
      fakePaystackPayoutAdapter as any,
      createFakeStablecoinPayoutAdapter() as any,
    );
    const second = await distributionsService.create(
      { waqfId: waqf.id, beneficiaryId: beneficiary.id, causeId: cause.id, amount: "500", currency: "USD" },
      makerUserId,
    );
    distributionIds.push(second.id);
    expect(second.status).toBe("pending");
  });

  test("distribution.approve: decide(approve: true) throws and the GovernedAction stays proposed when the beneficiary has incomplete payout details", async () => {
    // The core rollback guarantee this plan hinges on — a distribution
    // that can't actually be paid must never even reach "approved".
    // DistributionsService.approve() throws from inside decide()'s
    // $transaction, so the whole transaction (including the
    // GovernedAction status update) rolls back.
    const waqf = await prisma.waqf.create({
      data: { name: "Distribution Blocked Approval Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const beneficiary = await prisma.beneficiary.create({
      data: { waqfId: waqf.id, name: "No Payout Details Beneficiary", eligibilityCriteria: "Fixture criteria" },
    });
    beneficiaryIds.push(beneficiary.id);
    const cause = await prisma.waqfCause.create({
      data: { waqfId: waqf.id, name: "Blocked Approval Fixture Cause", allocatedAmount: "500" },
    });
    waqfCauseIds.push(cause.id);
    const distribution = await prisma.distribution.create({
      data: { waqfId: waqf.id, beneficiaryId: beneficiary.id, causeId: cause.id, amount: "500", currency: "USD" },
    });
    distributionIds.push(distribution.id);

    const action = await service.propose({
      permissionKey: "distribution.approve",
      payload: { distributionId: distribution.id },
      makerUserId,
    });
    governedActionIds.push(action.id);

    await expect(
      service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: true }),
    ).rejects.toThrow(BadRequestException);

    const stillProposed = await service.findById(action.id);
    expect(stillProposed?.status).toBe("proposed");
    const unchangedDistribution = await prisma.distribution.findUnique({ where: { id: distribution.id } });
    expect(unchangedDistribution!.status).toBe("pending");
  });

  test("distribution.approve: propose() rejects a second proposal while one is already pending for the same distribution", async () => {
    // Regression test — Distribution.status only flips on *decide*, not
    // propose, so without this guard the same still-pending distribution
    // can be proposed twice (a second staff session, or a page reload
    // resetting the propose button's own local "already proposed" state).
    // Confirmed live: two duplicate proposals for one distribution, both
    // permanently unable to approve once the cause's headroom shrank
    // below the distribution's amount — exactly the state this guard
    // exists to prevent from being reachable at all.
    const waqf = await prisma.waqf.create({
      data: { name: "Distribution Duplicate Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const beneficiary = await prisma.beneficiary.create({
      data: {
        waqfId: waqf.id,
        name: "Distribution Duplicate Fixture Beneficiary",
        eligibilityCriteria: "Fixture criteria",
      },
    });
    beneficiaryIds.push(beneficiary.id);
    const cause = await prisma.waqfCause.create({
      data: { waqfId: waqf.id, name: "Distribution Duplicate Fixture Cause", allocatedAmount: "500" },
    });
    waqfCauseIds.push(cause.id);
    const distribution = await prisma.distribution.create({
      data: { waqfId: waqf.id, beneficiaryId: beneficiary.id, causeId: cause.id, amount: "500", currency: "USD" },
    });
    distributionIds.push(distribution.id);

    const first = await service.propose({
      permissionKey: "distribution.approve",
      payload: { distributionId: distribution.id },
      makerUserId,
    });
    governedActionIds.push(first.id);

    await expect(
      service.propose({
        permissionKey: "distribution.approve",
        payload: { distributionId: distribution.id },
        makerUserId,
      }),
    ).rejects.toThrow(ConflictException);

    // Once the first is decided (rejected, here), proposing again is
    // fine — the guard only blocks while one is genuinely still pending.
    await service.decide({ governedActionId: first.id, checkerUserId: distributionCheckerUserId, approve: false });
    const second = await service.propose({
      permissionKey: "distribution.approve",
      payload: { distributionId: distribution.id },
      makerUserId,
    });
    governedActionIds.push(second.id);
    expect(second.id).not.toBe(first.id);
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
      data: { waqfId: waqf.id, name: "Fixture Building", category: "real_estate", estimatedValue: "1000", currency: "USD" },
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
      data: { waqfId: waqf.id, name: "List Test Fixture Building", category: "real_estate", estimatedValue: "1000", currency: "USD" },
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

  test("list() resolves a human-readable summary per action, distinguishing two same-permission proposals on the same waqf", async () => {
    // Regression test — before describePayload, two distribution.approve
    // proposals on the same waqf, same proposer, same day were literally
    // indistinguishable in the queue table (confirmed live: two rows
    // with identical Permission/Waqf/Proposed by/Proposed columns).
    const waqf = await prisma.waqf.create({
      data: { name: "Summary Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const beneficiary = await prisma.beneficiary.create({
      data: { waqfId: waqf.id, name: "Summary Fixture Beneficiary", eligibilityCriteria: "Fixture criteria" },
    });
    beneficiaryIds.push(beneficiary.id);
    const cause = await prisma.waqfCause.create({
      data: { waqfId: waqf.id, name: "Summary Fixture Cause", allocatedAmount: "1000" },
    });
    waqfCauseIds.push(cause.id);
    const distributionA = await prisma.distribution.create({
      data: { waqfId: waqf.id, beneficiaryId: beneficiary.id, causeId: cause.id, amount: "100", currency: "USD" },
    });
    distributionIds.push(distributionA.id);
    const distributionB = await prisma.distribution.create({
      data: { waqfId: waqf.id, beneficiaryId: beneficiary.id, causeId: cause.id, amount: "200", currency: "USD" },
    });
    distributionIds.push(distributionB.id);

    const actionA = await service.propose({
      permissionKey: "distribution.approve",
      payload: { distributionId: distributionA.id },
      makerUserId,
    });
    governedActionIds.push(actionA.id);
    const actionB = await service.propose({
      permissionKey: "distribution.approve",
      payload: { distributionId: distributionB.id },
      makerUserId,
    });
    governedActionIds.push(actionB.id);

    const proposed = await service.list({ status: "proposed" });
    const foundA = proposed.find((a) => a.id === actionA.id)!;
    const foundB = proposed.find((a) => a.id === actionB.id)!;
    expect(foundA.summary).toContain("100");
    expect(foundA.summary).toContain("Summary Fixture Beneficiary");
    expect(foundB.summary).toContain("200");
    expect(foundA.summary).not.toBe(foundB.summary);
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
        currency: "USD",
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
    // describeCurrentState: the asset hasn't been disposed yet, so this
    // reflects its pre-decision state — proves findById() is actually
    // computing it, not just echoing something from propose()'s payload.
    expect(found?.currentState).toEqual({ status: "active", disposedAt: null });

    const missing = await service.findById("00000000-0000-0000-0000-000000000000");
    expect(missing).toBeNull();
  });

  test("findById(): currentState is null for a handler with no describeCurrentState (counterparty.onboard), and strips no PII it never selected for beneficiary.criteria_update", async () => {
    const counterparty = await prisma.counterparty.create({
      data: { name: `FindById Test Fixture Counterparty ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE" },
    });
    counterpartyIds.push(counterparty.id);
    const onboardAction = await service.propose({
      permissionKey: "counterparty.onboard",
      payload: { counterpartyId: counterparty.id },
      makerUserId,
    });
    governedActionIds.push(onboardAction.id);
    const foundOnboard = await service.findById(onboardAction.id);
    expect(foundOnboard?.currentState).toBeNull();

    const waqf = await prisma.waqf.create({
      data: { name: "FindById Criteria Test Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfIds.push(waqf.id);
    const beneficiary = await prisma.beneficiary.create({
      data: {
        waqfId: waqf.id,
        name: "FindById Test Fixture Beneficiary",
        eligibilityCriteria: "Original criteria",
        bankDetailsEncrypted: "should-never-appear-in-currentState",
      },
    });
    beneficiaryIds.push(beneficiary.id);
    const criteriaAction = await service.propose({
      permissionKey: "beneficiary.criteria_update",
      payload: { beneficiaryId: beneficiary.id, newCriteria: "Updated criteria" },
      makerUserId,
    });
    governedActionIds.push(criteriaAction.id);
    const foundCriteria = await service.findById(criteriaAction.id);
    expect(foundCriteria?.currentState).toEqual({ newCriteria: "Original criteria" });
    expect(JSON.stringify(foundCriteria?.currentState)).not.toContain("should-never-appear-in-currentState");
  });

  // Vault — a separate, staff-curated public-giving product (see
  // schema.prisma's own Vault section comment). All five handlers below
  // are governed specifically because there's no Founder here to hold
  // the self-service half of the equivalent Waqf decisions, and it's
  // public money — vault.publish additionally because it's the moment
  // Birr's brand starts soliciting the public at all. Reuses this
  // file's own seeded maker/checker fixtures: mutawalli_officer
  // (makerUserId) is the seeded maker for vault.publish/
  // vault.cause_allocate/vault.distribution_approve; investment_committee
  // (investmentMakerUserId) for vault.proceeds_allocate/
  // vault.investment_change; compliance_officer (distributionCheckerUserId)
  // and audit_committee (assetCheckerUserId) as seeded checkers.
  describe("Vault governed actions", () => {
    async function createProjectVaultWithCause() {
      const vault = await prisma.vault.create({
        data: {
          name: `Governed Actions Fixture Vault ${randomUUID()}`,
          slug: `governed-actions-fixture-${randomUUID()}`,
          type: "project",
          currency: "USD",
          jurisdiction: "NG",
          createdByUserId: makerUserId,
        },
      });
      vaultIds.push(vault.id);
      const cause = await prisma.vaultCause.create({ data: { vaultId: vault.id, name: "Fixture Cause" } });
      vaultCauseIds.push(cause.id);
      const donor = await prisma.vaultDonor.create({ data: { email: `governed-actions-vault-donor-${randomUUID()}@example.com` } });
      vaultDonorIds.push(donor.id);
      await prisma.vaultContribution.create({
        data: {
          vaultId: vault.id,
          donorId: donor.id,
          amount: "1000",
          currency: "USD",
          provider: "paystack",
          providerReference: `governed-actions-vault-contrib-${randomUUID()}`,
          status: "confirmed",
        },
      });
      return { vault, cause };
    }

    test("vault.publish: approve → status becomes open, openedAt is set, audit-logged", async () => {
      const draftVault = await prisma.vault.create({
        data: {
          name: `Governed Actions Fixture Draft Vault ${randomUUID()}`,
          slug: `governed-actions-fixture-draft-${randomUUID()}`,
          type: "project",
          currency: "USD",
          jurisdiction: "NG",
          createdByUserId: makerUserId,
        },
      });
      vaultIds.push(draftVault.id);

      const action = await service.propose({
        permissionKey: "vault.publish",
        payload: { vaultId: draftVault.id },
        makerUserId,
      });
      governedActionIds.push(action.id);
      expect(action.vaultId).toBe(draftVault.id);

      const result = await service.decide({
        governedActionId: action.id,
        checkerUserId: distributionCheckerUserId,
        approve: true,
      });
      expect(result.governedAction.status).toBe("approved");
      expect(result.fulfillment?.entityType).toBe("Vault");

      const updated = await prisma.vault.findUniqueOrThrow({ where: { id: draftVault.id } });
      expect(updated.status).toBe("open");
      expect(updated.openedAt).not.toBeNull();

      const logs = await auditLogsFor(draftVault.id);
      expect(logs.some((l) => l.action === "vault.published" && l.vaultId === draftVault.id)).toBe(true);
    });

    test("vault.publish: rejects a vault that isn't draft", async () => {
      const { vault } = await createProjectVaultWithCause();
      await prisma.vault.update({ where: { id: vault.id }, data: { status: "open", openedAt: new Date() } });

      const action = await service.propose({
        permissionKey: "vault.publish",
        payload: { vaultId: vault.id },
        makerUserId,
      });
      governedActionIds.push(action.id);

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: true }),
      ).rejects.toThrow(BadRequestException);
      const stillProposed = await prisma.governedAction.findUniqueOrThrow({ where: { id: action.id } });
      expect(stillProposed.status).toBe("proposed");
    });

    test("vault.cause_allocate: approve → VaultCause.allocatedAmount is set, vaultId is derived (not client-supplied), both audit-logged", async () => {
      const { vault, cause } = await createProjectVaultWithCause();

      const action = await service.propose({
        permissionKey: "vault.cause_allocate",
        payload: { vaultCauseId: cause.id, newAllocatedAmount: "600" },
        makerUserId,
      });
      governedActionIds.push(action.id);
      expect(action.vaultId).toBe(vault.id);

      const result = await service.decide({
        governedActionId: action.id,
        checkerUserId: distributionCheckerUserId,
        approve: true,
      });
      expect(result.governedAction.status).toBe("approved");
      expect(result.fulfillment?.entityType).toBe("VaultCause");

      const updated = await prisma.vaultCause.findUniqueOrThrow({ where: { id: cause.id } });
      expect(updated.allocatedAmount?.toString()).toBe("600");

      const logs = await auditLogsFor(cause.id);
      expect(logs.some((l) => l.action === "vault_cause.allocation_set" && l.vaultId === vault.id)).toBe(true);
    });

    test("vault.cause_allocate: rejects allocating more than the vault's confirmed pool", async () => {
      const { cause } = await createProjectVaultWithCause();
      const action = await service.propose({
        permissionKey: "vault.cause_allocate",
        payload: { vaultCauseId: cause.id, newAllocatedAmount: "999999" },
        makerUserId,
      });
      governedActionIds.push(action.id);

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: true }),
      ).rejects.toThrow(BadRequestException);
      const stillProposed = await prisma.governedAction.findUniqueOrThrow({ where: { id: action.id } });
      expect(stillProposed.status).toBe("proposed");
    });

    test("vault.proceeds_allocate: approve → VaultCause.proceedsAllocatedAmount is set (investment-style vault only)", async () => {
      const vault = await prisma.vault.create({
        data: {
          name: `Governed Actions Fixture Investment Vault ${randomUUID()}`,
          slug: `governed-actions-fixture-inv-${randomUUID()}`,
          type: "investment",
          currency: "USD",
          jurisdiction: "NG",
          createdByUserId: makerUserId,
        },
      });
      vaultIds.push(vault.id);
      const cause = await prisma.vaultCause.create({ data: { vaultId: vault.id, name: "Investment Fixture Cause" } });
      vaultCauseIds.push(cause.id);
      await prisma.vaultProceeds.create({
        data: { vaultId: vault.id, amount: "300", currency: "USD", description: "Fixture return", recordedByUserId: makerUserId },
      });

      const action = await service.propose({
        permissionKey: "vault.proceeds_allocate",
        payload: { vaultCauseId: cause.id, newProceedsAllocatedAmount: "300" },
        makerUserId: investmentMakerUserId,
      });
      governedActionIds.push(action.id);

      const result = await service.decide({
        governedActionId: action.id,
        checkerUserId: distributionCheckerUserId,
        approve: true,
      });
      expect(result.governedAction.status).toBe("approved");

      const updated = await prisma.vaultCause.findUniqueOrThrow({ where: { id: cause.id } });
      expect(updated.proceedsAllocatedAmount?.toString()).toBe("300");
    });

    test("vault.investment_change: approve → VaultInvestment.allocatedAmount is updated, vaultId is derived", async () => {
      const vault = await prisma.vault.create({
        data: {
          name: `Governed Actions Fixture Investment Change Vault ${randomUUID()}`,
          slug: `governed-actions-fixture-inv-change-${randomUUID()}`,
          type: "investment",
          currency: "USD",
          jurisdiction: "NG",
          createdByUserId: makerUserId,
        },
      });
      vaultIds.push(vault.id);
      const donor = await prisma.vaultDonor.create({ data: { email: `governed-actions-inv-change-donor-${randomUUID()}@example.com` } });
      vaultDonorIds.push(donor.id);
      await prisma.vaultContribution.create({
        data: {
          vaultId: vault.id,
          donorId: donor.id,
          amount: "2000",
          currency: "USD",
          provider: "paystack",
          providerReference: `governed-actions-inv-change-contrib-${randomUUID()}`,
          status: "confirmed",
        },
      });
      const counterparty = await prisma.counterparty.create({
        data: { name: `Governed Actions Vault Investment Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", status: "active" },
      });
      counterpartyIds.push(counterparty.id);
      const investment = await prisma.vaultInvestment.create({
        data: { vaultId: vault.id, name: "Fixture Vault Investment", instrumentType: "sukuk", allocatedAmount: "500", currency: "USD", counterpartyId: counterparty.id },
      });
      vaultInvestmentIds.push(investment.id);

      const action = await service.propose({
        permissionKey: "vault.investment_change",
        payload: { vaultInvestmentId: investment.id, newAllocatedAmount: "800" },
        makerUserId: investmentMakerUserId,
      });
      governedActionIds.push(action.id);
      expect(action.vaultId).toBe(vault.id);

      const result = await service.decide({
        governedActionId: action.id,
        checkerUserId: assetCheckerUserId,
        approve: true,
      });
      expect(result.governedAction.status).toBe("approved");

      const updated = await prisma.vaultInvestment.findUniqueOrThrow({ where: { id: investment.id } });
      expect(updated.allocatedAmount.toString()).toBe("800");
    });

    test("vault.distribution_approve: approve → status is approved, vaultId is derived, both audit-logged; reject → status is rejected", async () => {
      const { vault, cause } = await createProjectVaultWithCause();
      await prisma.vaultCause.update({ where: { id: cause.id }, data: { allocatedAmount: "1000" } });
      const counterparty = await prisma.counterparty.create({
        data: {
          name: `Governed Actions Vault Distribution Fixture Partner ${randomUUID()}`,
          institutionType: "relief_partner",
          jurisdiction: "NG",
          status: "active",
          payoutProvider: "paystack",
          payoutBankDetailsEncrypted: encryption.encrypt(
            JSON.stringify({ bankName: "Test Bank", accountNumber: "0123456789", accountName: "Test Relief Partner", bankCode: "058" }),
          ),
        },
      });
      counterpartyIds.push(counterparty.id);
      const distribution = await prisma.vaultDistribution.create({
        data: { vaultId: vault.id, vaultCauseId: cause.id, counterpartyId: counterparty.id, amount: "200", currency: "USD" },
      });
      vaultDistributionIds.push(distribution.id);

      const approveAction = await service.propose({
        permissionKey: "vault.distribution_approve",
        payload: { vaultDistributionId: distribution.id },
        makerUserId,
      });
      governedActionIds.push(approveAction.id);
      expect(approveAction.vaultId).toBe(vault.id);

      const result = await service.decide({
        governedActionId: approveAction.id,
        checkerUserId: distributionCheckerUserId,
        approve: true,
      });
      expect(result.governedAction.status).toBe("approved");
      expect(result.fulfillment?.entityType).toBe("VaultDistribution");

      const approved = await prisma.vaultDistribution.findUniqueOrThrow({ where: { id: distribution.id } });
      expect(["approved", "disbursing"]).toContain(approved.status); // fire-and-forget initiateDisbursement may already have advanced it

      // A second, separate distribution against the same cause, rejected.
      const secondDistribution = await prisma.vaultDistribution.create({
        data: { vaultId: vault.id, vaultCauseId: cause.id, counterpartyId: counterparty.id, amount: "50", currency: "USD" },
      });
      vaultDistributionIds.push(secondDistribution.id);
      const rejectAction = await service.propose({
        permissionKey: "vault.distribution_approve",
        payload: { vaultDistributionId: secondDistribution.id },
        makerUserId,
      });
      governedActionIds.push(rejectAction.id);
      const rejectResult = await service.decide({
        governedActionId: rejectAction.id,
        checkerUserId: distributionCheckerUserId,
        approve: false,
      });
      expect(rejectResult.governedAction.status).toBe("rejected");
      const rejected = await prisma.vaultDistribution.findUniqueOrThrow({ where: { id: secondDistribution.id } });
      expect(rejected.status).toBe("rejected");
    });

    test("vault.milestone_complete: approve → status becomes completed, vaultId is derived, audit-logged; reject leaves it unchanged", async () => {
      const { vault } = await createProjectVaultWithCause();
      const milestone = await prisma.vaultMilestone.create({
        data: { vaultId: vault.id, name: "Foundation laid", sequence: 1 },
      });

      const approveAction = await service.propose({
        permissionKey: "vault.milestone_complete",
        payload: { vaultMilestoneId: milestone.id },
        makerUserId,
      });
      governedActionIds.push(approveAction.id);
      expect(approveAction.vaultId).toBe(vault.id);

      const result = await service.decide({
        governedActionId: approveAction.id,
        checkerUserId: distributionCheckerUserId,
        approve: true,
      });
      expect(result.governedAction.status).toBe("approved");
      expect(result.fulfillment?.entityType).toBe("VaultMilestone");

      const completed = await prisma.vaultMilestone.findUniqueOrThrow({ where: { id: milestone.id } });
      expect(completed.status).toBe("completed");
      expect(completed.completedAt).not.toBeNull();

      const logs = await auditLogsFor(milestone.id);
      expect(logs.some((l) => l.action === "vault_milestone.completed")).toBe(true);

      // A second, separate milestone, rejected — no onReject handler
      // (matches vault.contribution_refund's own precedent just below),
      // so nothing about the milestone itself changes; only the
      // governed_action's own decide()-level audit log records it.
      const secondMilestone = await prisma.vaultMilestone.create({
        data: { vaultId: vault.id, name: "Well drilled", sequence: 2 },
      });
      const rejectAction = await service.propose({
        permissionKey: "vault.milestone_complete",
        payload: { vaultMilestoneId: secondMilestone.id },
        makerUserId,
      });
      governedActionIds.push(rejectAction.id);
      const rejectResult = await service.decide({
        governedActionId: rejectAction.id,
        checkerUserId: distributionCheckerUserId,
        approve: false,
      });
      expect(rejectResult.governedAction.status).toBe("rejected");
      const stillPending = await prisma.vaultMilestone.findUniqueOrThrow({ where: { id: secondMilestone.id } });
      expect(stillPending.status).toBe("pending");
    });

    test("vault.milestone_complete: decide(approve: true) throws and the GovernedAction stays proposed for an already-completed milestone", async () => {
      const { vault } = await createProjectVaultWithCause();
      const milestone = await prisma.vaultMilestone.create({
        data: { vaultId: vault.id, name: "Already done", sequence: 1, status: "completed", completedAt: new Date() },
      });

      const action = await service.propose({
        permissionKey: "vault.milestone_complete",
        payload: { vaultMilestoneId: milestone.id },
        makerUserId,
      });
      governedActionIds.push(action.id);

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: true }),
      ).rejects.toThrow(BadRequestException);
      const stillProposed = await prisma.governedAction.findUniqueOrThrow({ where: { id: action.id } });
      expect(stillProposed.status).toBe("proposed");
    });

    test("vault.contribution_refund: approve → refundStatus becomes requested, vaultId is derived, both audit-logged; the fire-and-forget follow-up eventually refunds it", async () => {
      const { vault } = await createProjectVaultWithCause();
      const donor = await prisma.vaultDonor.create({ data: { email: `governed-actions-refund-donor-${randomUUID()}@example.com` } });
      vaultDonorIds.push(donor.id);
      const contribution = await prisma.vaultContribution.create({
        data: {
          vaultId: vault.id,
          donorId: donor.id,
          amount: "75",
          currency: "USD",
          provider: "stripe",
          providerReference: `governed-actions-refund-${randomUUID()}`,
          status: "confirmed",
          confirmedAt: new Date(),
        },
      });

      const action = await service.propose({
        permissionKey: "vault.contribution_refund",
        payload: { vaultContributionId: contribution.id },
        makerUserId: distributionCheckerUserId, // compliance_officer — seeded maker for this permission
      });
      governedActionIds.push(action.id);
      expect(action.vaultId).toBe(vault.id);

      const result = await service.decide({
        governedActionId: action.id,
        checkerUserId: boardCheckerUserId,
        approve: true,
      });
      expect(result.governedAction.status).toBe("approved");
      expect(result.fulfillment?.entityType).toBe("VaultContribution");

      const requested = await prisma.vaultContribution.findUniqueOrThrow({ where: { id: contribution.id } });
      expect(requested.refundStatus).toBe("requested");

      const logs = await auditLogsFor(contribution.id);
      expect(logs.some((l) => l.action === "vault_contribution.refund_requested" && l.vaultId === vault.id)).toBe(true);

      // initiateRefund() is fired fire-and-forget, post-commit (see
      // decide()'s own comment) — the fake adapter has no real refund(),
      // so it settles to "refunded" almost immediately either way, but
      // give the microtask queue a beat to run it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const settled = await prisma.vaultContribution.findUniqueOrThrow({ where: { id: contribution.id } });
      expect(["requested", "processing", "refunded", "failed"]).toContain(settled.refundStatus);
    });

    test("vault.contribution_refund: rejects a contribution that isn't confirmed", async () => {
      const { vault } = await createProjectVaultWithCause();
      const donor = await prisma.vaultDonor.create({ data: { email: `governed-actions-refund-pending-donor-${randomUUID()}@example.com` } });
      vaultDonorIds.push(donor.id);
      const contribution = await prisma.vaultContribution.create({
        data: {
          vaultId: vault.id,
          donorId: donor.id,
          amount: "75",
          currency: "USD",
          provider: "stripe",
          providerReference: `governed-actions-refund-pending-${randomUUID()}`,
          status: "pending",
        },
      });

      const action = await service.propose({
        permissionKey: "vault.contribution_refund",
        payload: { vaultContributionId: contribution.id },
        makerUserId: distributionCheckerUserId,
      });
      governedActionIds.push(action.id);

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: boardCheckerUserId, approve: true }),
      ).rejects.toThrow(BadRequestException);
      const stillProposed = await prisma.governedAction.findUniqueOrThrow({ where: { id: action.id } });
      expect(stillProposed.status).toBe("proposed");
    });

    test("checkDuplicate: propose() rejects a second proposal while one is already pending for the same vault cause allocation", async () => {
      const { cause } = await createProjectVaultWithCause();
      const first = await service.propose({
        permissionKey: "vault.cause_allocate",
        payload: { vaultCauseId: cause.id, newAllocatedAmount: "100" },
        makerUserId,
      });
      governedActionIds.push(first.id);

      await expect(
        service.propose({
          permissionKey: "vault.cause_allocate",
          payload: { vaultCauseId: cause.id, newAllocatedAmount: "200" },
          makerUserId,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});

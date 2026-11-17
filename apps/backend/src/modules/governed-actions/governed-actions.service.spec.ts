import { SettingsService } from "../../common/settings/settings.service";
import { ClinicReserveService } from "../clinic-waqfs/clinic-reserve.service";
import { CounterpartyLicensesService, lagosToday } from "../counterparties/counterparty-licenses.service";
import { REQUIRED_COUNTERPARTY_LICENSES } from "@birr/shared";
import { ClinicClaimsService } from "../clinic-waqfs/clinic-claims.service";
import { ClinicPriceListsService, canonicalPriceList, priceListHash } from "../clinic-waqfs/clinic-price-lists.service";
import { ClinicSpendingService } from "../clinic-waqfs/clinic-spending.service";
import { ClinicInvestmentsService } from "../clinic-waqfs/clinic-investments.service";
import { ClinicAssetsService } from "../clinic-waqfs/clinic-assets.service";
import { ClinicLedgerService } from "../clinic-waqfs/clinic-ledger.service";
import { ClinicWaqfsService } from "../clinic-waqfs/clinic-waqfs.service";
import { prisma, Beneficiary, Investment, Distribution, BirrStaffRole } from "@birr/db";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Request } from "express";
import { resolveBirrStaffFromSession } from "../../common/auth/current-birr-staff";
import { signSessionToken, STAFF_SESSION_COOKIE_NAME } from "../../common/auth/session";
import { GovernedActionsService, assertRoleChangeAllowed, assertSuspensionAllowed } from "./governed-actions.service";
import { staffHasAccess } from "../../common/auth/staff-permissions";
import { AssetsService } from "../assets/assets.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { InvestmentsService } from "../investments/investments.service";
import { CounterpartiesService } from "../counterparties/counterparties.service";
import { DistributionsService } from "../distributions/distributions.service";
import { BlogService } from "../blog/blog.service";
import { BirrStaffService } from "../birr-staff/birr-staff.service";
import { FoundersService } from "../founders/founders.service";
import { MfaService } from "../../common/auth/mfa.service";
import { VaultsService } from "../vaults/vaults.service";
import { VaultProceedsService } from "../vaults/vault-proceeds.service";
import { VaultInvestmentsService } from "../vaults/vault-investments.service";
import { VaultDistributionsService } from "../vaults/vault-distributions.service";
import { VaultContributionsService } from "../vaults/vault-contributions.service";
import { VaultLedgerService } from "../vaults/vault-ledger.service";
import { VaultMilestonesService } from "../vaults/vault-milestones.service";
import { WaqfLedgerService } from "../waqf-ledger/waqf-ledger.service";
import { WaqfMilestonesService } from "../waqf-ledger/waqf-milestones.service";
import {
  FakePaystackPayoutAdapter,
  createFakeStripePayoutAdapter,
  createFakeStablecoinPayoutAdapter,
} from "../distributions/test-support/fake-payout-adapters";
import { EncryptionService } from "../../common/settings/encryption.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import { FunnelEventsService } from "../funnel-events/funnel-events.service";
import { InvitationsService } from "../invitations/invitations.service";
import { ResendInvitationEmailAdapter } from "../invitations/email/resend-invitation.adapter";
import { ZakahService } from "../zakah/zakah.service";
import { ZakahDistributionsService } from "../zakah/zakah-distributions.service";
import { ZakahLedgerService } from "../zakah/zakah-ledger.service";
import { ZakahRefundsService } from "../zakah/zakah-refunds.service";
import { ZakahFitrService } from "../zakah/zakah-fitr.service";
import { unusedFitrSeason } from "../zakah/test-support-fitr";
import { lockZakahCommitments } from "../zakah/zakah-commitments";
import { draftRulesets } from "@birr/zakah";
import { createFakeRecurringGiftsCore } from "../recurring-gifts/test-support/fake-recurring-gifts";
import { FounderSuccessionService } from "../founder-succession/founder-succession.service";

// Minimal fake, same shape as vault-contributions.service.spec.ts's own
// local FakeAdapter/FakeReceiptEmailAdapter — duplicated rather than
// shared, matching this codebase's existing precedent of no extracted
// test-support fake for PaymentProviderAdapter (contributions.service
// .spec.ts also defines its own locally). Nothing in this file's own
// tests calls createPayment/verifyAndParseWebhook/refund for real —
// requestRefund() (the only VaultContributionsService method exercised
// here) never touches the adapter map at all.
// staff.invite's post-commit email — records what would have been sent.
class FakeInvitationEmailAdapter {
  sent: { to: string; link: string }[] = [];

  sendInvitationEmail(to: string, link: string): Promise<void> {
    this.sent.push({ to, link });
    return Promise.resolve();
  }
}

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

// 2026-09-26 audit fix — same poll-instead-of-fixed-sleep reasoning as
// messages.service.spec.ts's own waitForNotifications: a single fixed
// setTimeout before asserting on a fire-and-forget side effect
// (decide()'s post-commit initiateRefund() call) is inherently racy
// under load, and the test this replaced compounded that by accepting
// "requested" — the pre-side-effect value — in its expected set, which
// meant it couldn't fail even if the side effect never ran at all. Poll
// for the terminal state instead.
const NON_TERMINAL_REFUND_STATUSES = ["requested", "processing"];
async function waitForRefundSettled(vaultContributionId: string) {
  const deadline = Date.now() + 15000;
  let contribution = await prisma.vaultContribution.findUniqueOrThrow({ where: { id: vaultContributionId } });
  while (NON_TERMINAL_REFUND_STATUSES.includes(contribution.refundStatus ?? "") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    contribution = await prisma.vaultContribution.findUniqueOrThrow({ where: { id: vaultContributionId } });
  }
  return contribution;
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
  const invitationEmails = new FakeInvitationEmailAdapter();
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
  // Dates metal-price fixtures in January 2001, so they can never become
  // the current prices — see zakah.service.spec.ts's own note.
  const zakahService = new ZakahService();
  zakahService.now = () => new Date("2001-01-15T12:00:00Z");
  const zakahDistributionsService = new ZakahDistributionsService(new EncryptionService(), new ZakahLedgerService());
  // Records the payer emails a refund decision triggers after it commits.
  const refundNotices: { refundId: string; stage: string }[] = [];
  const zakahRefundsService = new ZakahRefundsService(new EncryptionService(), new ZakahLedgerService(), {
    sendRefundNotice: async (n: { refundId: string; stage: string }) => void refundNotices.push(n),
  } as never);
  const zakahFitrService = new ZakahFitrService();
  const service = new GovernedActionsService(
    new AssetsService(),
    beneficiariesService,
    new InvestmentsService(),
    new CounterpartiesService(encryption),
    new DistributionsService(
      beneficiariesService,
      notificationsService,
      new WaqfLedgerService(),
      createFakeStripePayoutAdapter() as any,
      fakePaystackPayoutAdapter as any,
      createFakeStablecoinPayoutAdapter() as any,
    ),
    new VaultsService(new VaultProceedsService(), vaultLedgerService),
    new VaultInvestmentsService(),
    new VaultDistributionsService(encryption, vaultLedgerService, fakePaystackPayoutAdapter as any),
    new VaultContributionsService(
      encryption,
      new FakeVaultReceiptEmailAdapter() as any,
      vaultLedgerService,
      new FunnelEventsService(),
      createFakeRecurringGiftsCore().core,
      new FakeVaultPaymentAdapter() as any,
      new FakeVaultPaymentAdapter() as any,
      new FakeVaultPaymentAdapter() as any,
    ),
    new VaultMilestonesService(),
    new WaqfMilestonesService(),
    notificationsService,
    new BlogService(),
    new BirrStaffService(new EncryptionService(), new MfaService()),
    new FoundersService(undefined as never, undefined as never, new EncryptionService(), new MfaService(), new FunnelEventsService()),
    new InvitationsService(invitationEmails as unknown as ResendInvitationEmailAdapter, notificationsService),
    zakahService,
    zakahDistributionsService,
    zakahRefundsService,
    zakahFitrService,
    new FounderSuccessionService(notificationsService, new SettingsService(new EncryptionService())),
    new ClinicWaqfsService(),
    new ClinicAssetsService(new ClinicLedgerService()),
    new ClinicSpendingService(new ClinicLedgerService()),
    new ClinicPriceListsService(),
    new ClinicClaimsService(new ClinicLedgerService(), new ClinicPriceListsService()),
    new ClinicReserveService(new ClinicLedgerService()),
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
  const blogArticleIds: string[] = [];

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
      data: { userId: makerUser.id, roles: { create: { role: "mutawalli_officer" } } },
    });

    const assetCheckerUser = await prisma.user.create({
      data: { email: `asset-checker-${Date.now()}@example.com`, fullName: "Test Asset Checker" },
    });
    assetCheckerUserId = assetCheckerUser.id;
    await prisma.birrStaff.create({
      data: { userId: assetCheckerUser.id, roles: { create: { role: "audit_committee" } } },
    });

    const beneficiaryCheckerUser = await prisma.user.create({
      data: {
        email: `beneficiary-checker-${Date.now()}@example.com`,
        fullName: "Test Beneficiary Checker",
      },
    });
    beneficiaryCheckerUserId = beneficiaryCheckerUser.id;
    await prisma.birrStaff.create({
      data: { userId: beneficiaryCheckerUser.id, roles: { create: { role: "shariah_board_member" } } },
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
      data: { userId: investmentMakerUser.id, roles: { create: { role: "investment_committee" } } },
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
      data: { userId: distributionCheckerUser.id, roles: { create: { role: "compliance_officer" } } },
    });

    // vault.contribution_refund's seeded checker — compliance_officer
    // (distributionCheckerUserId, above) is its seeded maker.
    const boardCheckerUser = await prisma.user.create({
      data: { email: `board-checker-${Date.now()}@example.com`, fullName: "Test Board Checker" },
    });
    boardCheckerUserId = boardCheckerUser.id;
    await prisma.birrStaff.create({
      data: { userId: boardCheckerUser.id, roles: { create: { role: "board_of_trustees" } } },
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
    await prisma.blogArticle.deleteMany({ where: { id: { in: blogArticleIds } } });
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
    // RESTRICT on investmentId, must go before Investment itself.
    await prisma.shariahScreening.deleteMany({ where: { investmentId: { in: investmentIds } } });
    await prisma.investment.deleteMany({ where: { id: { in: investmentIds } } });
    // Vault side — same FK-safe ordering reasoning as the Waqf side
    // above: VaultDistribution/VaultInvestment (RESTRICT on vaultId)
    // before VaultCause (RESTRICT on vaultId) before Vault; VaultDonor
    // has no incoming RESTRICT from anything left standing once
    // VaultContribution rows created via the real flow tests are gone.
    await prisma.vaultDistribution.deleteMany({ where: { id: { in: vaultDistributionIds } } });
    // RESTRICT on vaultInvestmentId, must go before VaultInvestment itself.
    await prisma.vaultShariahScreening.deleteMany({ where: { vaultInvestmentId: { in: vaultInvestmentIds } } });
    await prisma.vaultInvestment.deleteMany({ where: { id: { in: vaultInvestmentIds } } });
    // RESTRICT on vaultId, same reasoning as VaultDistribution/
    // VaultInvestment above — after VaultDistribution (already gone,
    // and its own vaultMilestoneId FK is ON DELETE SET NULL anyway).
    await prisma.vaultMilestone.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultProceeds.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultContribution.deleteMany({ where: { vaultId: { in: vaultIds } } });
    // RESTRICT on vaultCauseId, must go before VaultCause itself.
    await prisma.vaultCauseAllocation.deleteMany({ where: { vaultCauseId: { in: vaultCauseIds } } });
    await prisma.vaultCause.deleteMany({ where: { id: { in: vaultCauseIds } } });
    // A refund now posts a reversing journal entry, so fixture vaults can
    // have ledger rows even when no contribution was ever confirmed here.
    await prisma.vaultJournalEntryLine.deleteMany({ where: { journalEntry: { vaultId: { in: vaultIds } } } });
    await prisma.vaultJournalEntry.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    // People the audit log names (users, founders, Vault donors) are left
    // in place: audit_logs refuses their deletion (2026-11-15), so history
    // is never rewritten.
    await prisma.counterparty.deleteMany({ where: { id: { in: counterpartyIds } } });
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    // RESTRICT on waqfId, same reasoning as vaultMilestone above.
    await prisma.waqfMilestone.deleteMany({ where: { waqfId: { in: waqfIds } } });
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
    await prisma.birrStaff.create({ data: { userId: secondChecker.id, roles: { create: { role: "compliance_officer" } } } });

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
      new WaqfLedgerService(),
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

    // Scoped to this test's own waqf: the shared dev database holds hundreds
    // of decided actions from earlier runs, and listing them all (each with
    // its summary looked up) outgrew the test timeout.
    const proposed = await service.list({ status: "proposed", waqfId: waqf.id });
    expect(proposed.some((a) => a.id === action.id)).toBe(true);
    const found = proposed.find((a) => a.id === action.id)!;
    expect(found.permission.key).toBe("asset.dispose");

    const approved = await service.list({ status: "approved", waqfId: waqf.id });
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

    test("vault.cause_allocate: approve → VaultCauseAllocation.allocatedAmount is set for that currency, vaultId is derived (not client-supplied), both audit-logged", async () => {
      const { vault, cause } = await createProjectVaultWithCause();

      const action = await service.propose({
        permissionKey: "vault.cause_allocate",
        payload: { vaultCauseId: cause.id, currency: "USD", newAllocatedAmount: "600" },
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

      const updated = await prisma.vaultCauseAllocation.findUniqueOrThrow({
        where: { vaultCauseId_currency: { vaultCauseId: cause.id, currency: "USD" } },
      });
      expect(updated.allocatedAmount.toString()).toBe("600");

      const logs = await auditLogsFor(cause.id);
      expect(logs.some((l) => l.action === "vault_cause.allocation_set" && l.vaultId === vault.id)).toBe(true);
    });

    test("vault.cause_allocate: rejects allocating more than the vault's confirmed pool", async () => {
      const { cause } = await createProjectVaultWithCause();
      const action = await service.propose({
        permissionKey: "vault.cause_allocate",
        payload: { vaultCauseId: cause.id, currency: "USD", newAllocatedAmount: "999999" },
        makerUserId,
      });
      governedActionIds.push(action.id);

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: true }),
      ).rejects.toThrow(BadRequestException);
      const stillProposed = await prisma.governedAction.findUniqueOrThrow({ where: { id: action.id } });
      expect(stillProposed.status).toBe("proposed");
    });

    test("vault.cause_allocate: a second currency's allocation is independent of the primary currency's pool/ceiling", async () => {
      const vault = await prisma.vault.create({
        data: {
          name: `Governed Actions Fixture Multi-Currency Vault ${randomUUID()}`,
          slug: `governed-actions-fixture-multicur-${randomUUID()}`,
          type: "project",
          currency: "USD",
          additionalCurrencies: ["NGN"],
          jurisdiction: "NG",
          createdByUserId: makerUserId,
        },
      });
      vaultIds.push(vault.id);
      const cause = await prisma.vaultCause.create({ data: { vaultId: vault.id, name: "Multi-Currency Fixture Cause" } });
      vaultCauseIds.push(cause.id);
      const donor = await prisma.vaultDonor.create({ data: { email: `governed-actions-multicur-donor-${randomUUID()}@example.com` } });
      vaultDonorIds.push(donor.id);
      await prisma.vaultContribution.create({
        data: {
          vaultId: vault.id,
          donorId: donor.id,
          amount: "1000",
          currency: "USD",
          provider: "paystack",
          providerReference: `governed-actions-multicur-usd-${randomUUID()}`,
          status: "confirmed",
        },
      });
      await prisma.vaultContribution.create({
        data: {
          vaultId: vault.id,
          donorId: donor.id,
          amount: "500000",
          currency: "NGN",
          provider: "paystack",
          providerReference: `governed-actions-multicur-ngn-${randomUUID()}`,
          status: "confirmed",
        },
      });

      // Fully allocate the USD pool first.
      const usdAction = await service.propose({
        permissionKey: "vault.cause_allocate",
        payload: { vaultCauseId: cause.id, currency: "USD", newAllocatedAmount: "1000" },
        makerUserId,
      });
      governedActionIds.push(usdAction.id);
      await service.decide({ governedActionId: usdAction.id, checkerUserId: distributionCheckerUserId, approve: true });

      // NGN's own pool is untouched by USD's already being fully
      // allocated — a genuinely independent ceiling, not a shared bare
      // number.
      const ngnAction = await service.propose({
        permissionKey: "vault.cause_allocate",
        payload: { vaultCauseId: cause.id, currency: "NGN", newAllocatedAmount: "500000" },
        makerUserId,
      });
      governedActionIds.push(ngnAction.id);
      const ngnResult = await service.decide({ governedActionId: ngnAction.id, checkerUserId: distributionCheckerUserId, approve: true });
      expect(ngnResult.governedAction.status).toBe("approved");

      const usdAllocation = await prisma.vaultCauseAllocation.findUniqueOrThrow({
        where: { vaultCauseId_currency: { vaultCauseId: cause.id, currency: "USD" } },
      });
      const ngnAllocation = await prisma.vaultCauseAllocation.findUniqueOrThrow({
        where: { vaultCauseId_currency: { vaultCauseId: cause.id, currency: "NGN" } },
      });
      expect(usdAllocation.allocatedAmount.toString()).toBe("1000");
      expect(ngnAllocation.allocatedAmount.toString()).toBe("500000");
    });

    test("vault.proceeds_allocate: approve → VaultCauseAllocation.proceedsAllocatedAmount is set for that currency (investment-style vault only)", async () => {
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
        payload: { vaultCauseId: cause.id, currency: "USD", newProceedsAllocatedAmount: "300" },
        makerUserId: investmentMakerUserId,
      });
      governedActionIds.push(action.id);

      const result = await service.decide({
        governedActionId: action.id,
        checkerUserId: distributionCheckerUserId,
        approve: true,
      });
      expect(result.governedAction.status).toBe("approved");

      const updated = await prisma.vaultCauseAllocation.findUniqueOrThrow({
        where: { vaultCauseId_currency: { vaultCauseId: cause.id, currency: "USD" } },
      });
      expect(updated.proceedsAllocatedAmount.toString()).toBe("300");
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
      await prisma.vaultCauseAllocation.create({ data: { vaultCauseId: cause.id, currency: "USD", allocatedAmount: "1000" } });
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

    // Founder/Waqf-side counterpart to vault.milestone_complete above
    // (2026-09-15) — same maker/checker pairing as distribution.approve
    // (mutawalli_officer proposes, compliance_officer approves), since
    // it carries the same fiduciary weight.
    test("waqf.milestone_complete: approve → status becomes completed, waqfId is derived, audit-logged; reject leaves it unchanged", async () => {
      const waqf = await prisma.waqf.create({
        data: { name: "Waqf Milestone Complete Fixture Waqf", type: "project", jurisdiction: "AE", foundationId },
      });
      waqfIds.push(waqf.id);
      const milestone = await prisma.waqfMilestone.create({
        data: { waqfId: waqf.id, name: "Foundation laid", sequence: 1 },
      });

      const approveAction = await service.propose({
        permissionKey: "waqf.milestone_complete",
        payload: { waqfMilestoneId: milestone.id },
        makerUserId,
      });
      governedActionIds.push(approveAction.id);
      expect(approveAction.waqfId).toBe(waqf.id);

      const result = await service.decide({
        governedActionId: approveAction.id,
        checkerUserId: distributionCheckerUserId,
        approve: true,
      });
      expect(result.governedAction.status).toBe("approved");
      expect(result.fulfillment?.entityType).toBe("WaqfMilestone");

      const completed = await prisma.waqfMilestone.findUniqueOrThrow({ where: { id: milestone.id } });
      expect(completed.status).toBe("completed");
      expect(completed.completedAt).not.toBeNull();

      const logs = await auditLogsFor(milestone.id);
      expect(logs.some((l) => l.action === "waqf_milestone.completed")).toBe(true);

      // A second, separate milestone, rejected — no onReject handler,
      // same precedent as vault.milestone_complete — nothing about the
      // milestone itself changes; only the governed_action's own
      // decide()-level audit log records it.
      const secondMilestone = await prisma.waqfMilestone.create({
        data: { waqfId: waqf.id, name: "Well drilled", sequence: 2 },
      });
      const rejectAction = await service.propose({
        permissionKey: "waqf.milestone_complete",
        payload: { waqfMilestoneId: secondMilestone.id },
        makerUserId,
      });
      governedActionIds.push(rejectAction.id);
      const rejectResult = await service.decide({
        governedActionId: rejectAction.id,
        checkerUserId: distributionCheckerUserId,
        approve: false,
      });
      expect(rejectResult.governedAction.status).toBe("rejected");
      const stillPending = await prisma.waqfMilestone.findUniqueOrThrow({ where: { id: secondMilestone.id } });
      expect(stillPending.status).toBe("pending");
    });

    test("waqf.milestone_complete: decide(approve: true) throws and the GovernedAction stays proposed for an already-completed milestone", async () => {
      const waqf = await prisma.waqf.create({
        data: { name: "Waqf Milestone Already Complete Fixture Waqf", type: "project", jurisdiction: "AE", foundationId },
      });
      waqfIds.push(waqf.id);
      const milestone = await prisma.waqfMilestone.create({
        data: { waqfId: waqf.id, name: "Already done", sequence: 1, status: "completed", completedAt: new Date() },
      });

      const action = await service.propose({
        permissionKey: "waqf.milestone_complete",
        payload: { waqfMilestoneId: milestone.id },
        makerUserId,
      });
      governedActionIds.push(action.id);

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: true }),
      ).rejects.toThrow(BadRequestException);
      const stillProposed = await prisma.governedAction.findUniqueOrThrow({ where: { id: action.id } });
      expect(stillProposed.status).toBe("proposed");
    });

    // The maker≠checker DB-constraint test CLAUDE.md's own working
    // process calls for, per governed action — asset.dispose already
    // has one; waqf.milestone_complete gets its own here rather than
    // relying solely on that shared table-wide constraint being proven
    // once (see the comprehensive Founder-side review that flagged this
    // gap generally).
    test("waqf.milestone_complete: the database itself rejects checkerUserId === makerUserId, bypassing decide() entirely", async () => {
      const waqf = await prisma.waqf.create({
        data: { name: "Waqf Milestone Checker Not Maker Fixture Waqf", type: "project", jurisdiction: "AE", foundationId },
      });
      waqfIds.push(waqf.id);
      const milestone = await prisma.waqfMilestone.create({
        data: { waqfId: waqf.id, name: "DB constraint fixture", sequence: 1 },
      });
      const action = await service.propose({
        permissionKey: "waqf.milestone_complete",
        payload: { waqfMilestoneId: milestone.id },
        makerUserId,
      });
      governedActionIds.push(action.id);

      await expect(
        prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } }),
      ).rejects.toThrow();
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
      // so it deterministically settles to "refunded". Poll for that
      // terminal state rather than a fixed sleep + an accepted-set
      // assertion that included the pre-side-effect value (see
      // waitForRefundSettled's own comment for why that couldn't fail).
      const settled = await waitForRefundSettled(contribution.id);
      expect(settled.refundStatus).toBe("refunded");
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
  // blog.publish (2026-10-01) — public educational articles. Maker is
  // mutawalli_officer (makerUserId); checkers are legal_adviser /
  // compliance_officer only. Not scoped to a Waqf or Vault.
  describe("blog.publish", () => {
    let legalUserId: string;
    let otherLegalUserId: string;

    beforeAll(async () => {
      const legal = await prisma.user.create({
        data: { email: `blog-legal-${Date.now()}@example.com`, fullName: "Test Legal Adviser" },
      });
      legalUserId = legal.id;
      await prisma.birrStaff.create({ data: { userId: legal.id, roles: { create: { role: "legal_adviser" } } } });
      const other = await prisma.user.create({
        data: { email: `blog-legal-2-${Date.now()}@example.com`, fullName: "Second Legal Adviser" },
      });
      otherLegalUserId = other.id;
      await prisma.birrStaff.create({ data: { userId: other.id, roles: { create: { role: "legal_adviser" } } } });
    });

    async function draftArticle(createdByUserId: string) {
      const article = await prisma.blogArticle.create({
        data: {
          slug: `blog-gov-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          title: "Governed Fixture Article",
          description: "A fixture article for governed-action tests.",
          body: "Body text.",
          category: "trust",
          illustration: "endowment",
          authorName: "Fixture Author",
          createdByUserId,
        },
      });
      blogArticleIds.push(article.id);
      return article;
    }

    test("approve → published, reviewer recorded from the checker, audit-logged", async () => {
      const article = await draftArticle(makerUserId);
      const action = await service.propose({ permissionKey: "blog.publish", payload: { articleId: article.id }, makerUserId });
      governedActionIds.push(action.id);

      await service.decide({ governedActionId: action.id, checkerUserId: legalUserId, approve: true });

      const published = await prisma.blogArticle.findUniqueOrThrow({ where: { id: article.id } });
      expect(published.status).toBe("published");
      expect(published.publishedAt).not.toBeNull();
      expect(published.reviewedByUserId).toBe(legalUserId);
      expect(published.reviewedByName).toBe("Test Legal Adviser");

      const logs = await prisma.auditLog.findMany({ where: { entityId: article.id } });
      expect(logs.some((l) => l.action === "blog_article.published" && l.actorUserId === legalUserId)).toBe(true);
    });

    test("reject → article stays a draft with no reviewer", async () => {
      const article = await draftArticle(makerUserId);
      const action = await service.propose({ permissionKey: "blog.publish", payload: { articleId: article.id }, makerUserId });
      governedActionIds.push(action.id);

      await service.decide({ governedActionId: action.id, checkerUserId: legalUserId, approve: false });

      const after = await prisma.blogArticle.findUniqueOrThrow({ where: { id: article.id } });
      expect(after.status).toBe("draft");
      expect(after.reviewedByUserId).toBeNull();
    });

    test("the proposer cannot approve their own publish proposal", async () => {
      const article = await draftArticle(otherLegalUserId);
      const action = await service.propose({ permissionKey: "blog.publish", payload: { articleId: article.id }, makerUserId });
      governedActionIds.push(action.id);

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: makerUserId, approve: true }),
      ).rejects.toThrow(ForbiddenException);
    });

    test("the database itself rejects checker_user_id = maker_user_id on a blog.publish action", async () => {
      const article = await draftArticle(makerUserId);
      const action = await service.propose({ permissionKey: "blog.publish", payload: { articleId: article.id }, makerUserId });
      governedActionIds.push(action.id);

      await expect(
        prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } }),
      ).rejects.toThrow();
    });

    test("an article's author cannot be the reviewer who approves it, even when someone else proposed it", async () => {
      const article = await draftArticle(legalUserId);
      const action = await service.propose({ permissionKey: "blog.publish", payload: { articleId: article.id }, makerUserId });
      governedActionIds.push(action.id);

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: legalUserId, approve: true }),
      ).rejects.toThrow(BadRequestException);
      expect((await prisma.blogArticle.findUniqueOrThrow({ where: { id: article.id } })).status).toBe("draft");
    });

    test("the database itself rejects a reviewer who is also the author, and a published row with no reviewer", async () => {
      const article = await draftArticle(legalUserId);
      await expect(
        prisma.blogArticle.update({
          where: { id: article.id },
          data: { status: "published", publishedAt: new Date(), reviewedByUserId: legalUserId, reviewedByName: "Self" },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.blogArticle.update({ where: { id: article.id }, data: { status: "published", publishedAt: new Date() } }),
      ).rejects.toThrow();
    });

    test("approving a proposal for an article that is no longer a draft fails", async () => {
      const article = await draftArticle(makerUserId);
      const action = await service.propose({ permissionKey: "blog.publish", payload: { articleId: article.id }, makerUserId });
      governedActionIds.push(action.id);
      await prisma.blogArticle.update({ where: { id: article.id }, data: { status: "archived", deletedAt: new Date() } });

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: legalUserId, approve: true }),
      ).rejects.toThrow();
    });

    test("a second pending proposal for the same article is rejected as a duplicate", async () => {
      const article = await draftArticle(makerUserId);
      const first = await service.propose({ permissionKey: "blog.publish", payload: { articleId: article.id }, makerUserId });
      governedActionIds.push(first.id);

      await expect(
        service.propose({ permissionKey: "blog.publish", payload: { articleId: article.id }, makerUserId }),
      ).rejects.toThrow(ConflictException);
    });
  });
  // staff.mfa_reset (2026-10-01) — replaced a Platform Admin's unilateral
  // reset. Maker: platform_admin; checkers: board_of_trustees /
  // compliance_officer. The affected person is notified when it lands.
  describe("staff.mfa_reset", () => {
    let adminUserId: string;
    let boardUserId: string;

    beforeAll(async () => {
      const admin = await prisma.user.create({
        data: { email: `mfa-admin-${Date.now()}@example.com`, fullName: "MFA Request Admin" },
      });
      adminUserId = admin.id;
      await prisma.birrStaff.create({ data: { userId: admin.id, roles: { create: { role: "platform_admin" } } } });
      const board = await prisma.user.create({
        data: { email: `mfa-board-${Date.now()}@example.com`, fullName: "MFA Approving Board Member" },
      });
      boardUserId = board.id;
      await prisma.birrStaff.create({ data: { userId: board.id, roles: { create: { role: "board_of_trustees" } } } });
    });

    async function enrolledStaff(label: string) {
      const user = await prisma.user.create({
        data: {
          email: `mfa-target-${label}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`,
          fullName: `MFA Target ${label}`,
          mfaEnabled: true,
          mfaSecretEncrypted: "not-a-real-secret",
        },
      });
      const staff = await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role: "mutawalli_officer" } } } });
      await prisma.mfaBackupCode.create({ data: { userId: user.id, codeHash: "x" } });
      return { user, staff };
    }

    test("approve → MFA cleared, audit-logged by the engine, and the affected person is notified", async () => {
      const { user, staff } = await enrolledStaff("approve");
      const action = await service.propose({ permissionKey: "staff.mfa_reset", payload: { staffId: staff.id, reason: "Confirmed by phone with the person on 16 November." }, makerUserId: adminUserId });
      governedActionIds.push(action.id);

      // Nothing changes on propose — a second person has to approve first.
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(true);

      await service.decide({ governedActionId: action.id, checkerUserId: boardUserId, approve: true });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.mfaEnabled).toBe(false);
      expect(after.mfaSecretEncrypted).toBeNull();
      expect(await prisma.mfaBackupCode.count({ where: { userId: user.id } })).toBe(0);

      const logs = await prisma.auditLog.findMany({ where: { entityId: user.id, action: "birr_staff.mfa_reset" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].actorUserId).toBe(boardUserId);

      // The notification is fire-and-forget after commit — poll briefly.
      let notice = null;
      for (let i = 0; i < 20 && !notice; i++) {
        notice = await prisma.notification.findFirst({ where: { recipientUserId: user.id, type: "birr_staff.mfa_reset" } });
        if (!notice) await new Promise((r) => setTimeout(r, 100));
      }
      expect(notice).not.toBeNull();
      expect(notice!.body).toContain("MFA Request Admin");
      expect(notice!.body).toContain("MFA Approving Board Member");
    });

    test("reject → MFA is left exactly as it was, and nobody is told it was reset", async () => {
      const { user, staff } = await enrolledStaff("reject");
      const action = await service.propose({ permissionKey: "staff.mfa_reset", payload: { staffId: staff.id, reason: "Confirmed by phone with the person on 16 November." }, makerUserId: adminUserId });
      governedActionIds.push(action.id);

      await service.decide({ governedActionId: action.id, checkerUserId: boardUserId, approve: false });

      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(true);
      expect(await prisma.notification.count({ where: { recipientUserId: user.id, type: "birr_staff.mfa_reset" } })).toBe(0);
    });

    test("the proposer cannot approve their own reset request, and the database refuses it too", async () => {
      const { staff } = await enrolledStaff("self");
      const action = await service.propose({ permissionKey: "staff.mfa_reset", payload: { staffId: staff.id, reason: "Confirmed by phone with the person on 16 November." }, makerUserId: adminUserId });
      governedActionIds.push(action.id);

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: adminUserId, approve: true }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: adminUserId } }),
      ).rejects.toThrow();
    });

    test("propose() rejects an unknown staff member, or one with no MFA enrolled", async () => {
      await expect(
        service.propose({ permissionKey: "staff.mfa_reset", payload: { staffId: randomUUID(), reason: "Confirmed by phone with the person on 16 November." }, makerUserId: adminUserId }),
      ).rejects.toThrow();
      const { staff, user } = await enrolledStaff("not-enrolled");
      await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEncrypted: null } });
      await expect(
        service.propose({ permissionKey: "staff.mfa_reset", payload: { staffId: staff.id, reason: "Confirmed by phone with the person on 16 November." }, makerUserId: adminUserId }),
      ).rejects.toThrow(BadRequestException);
    });

    test("a second pending request for the same person is rejected as a duplicate", async () => {
      const { staff } = await enrolledStaff("dup");
      const first = await service.propose({ permissionKey: "staff.mfa_reset", payload: { staffId: staff.id, reason: "Confirmed by phone with the person on 16 November." }, makerUserId: adminUserId });
      governedActionIds.push(first.id);
      await expect(
        service.propose({ permissionKey: "staff.mfa_reset", payload: { staffId: staff.id, reason: "Confirmed by phone with the person on 16 November." }, makerUserId: adminUserId }),
      ).rejects.toThrow(ConflictException);
    });
  });
  // staff.invite (2026-10-18) — adding a staff member used to be one
  // Platform Admin's unilateral invitation, which let one person add a
  // second account of their own under a checker role. Maker:
  // platform_admin; checkers: board_of_trustees / compliance_officer.
  describe("staff.invite", () => {
    let adminUserId: string;
    let complianceUserId: string;
    const invitationEmailsSeen: string[] = [];

    beforeAll(async () => {
      const admin = await prisma.user.create({
        data: { email: `sinv-admin-${Date.now()}@example.com`, fullName: "Staff Invite Proposing Admin" },
      });
      adminUserId = admin.id;
      await prisma.birrStaff.create({ data: { userId: admin.id, roles: { create: { role: "platform_admin" } } } });
      const compliance = await prisma.user.create({
        data: { email: `sinv-compliance-${Date.now()}@example.com`, fullName: "Staff Invite Approving Compliance" },
      });
      complianceUserId = compliance.id;
      await prisma.birrStaff.create({ data: { userId: compliance.id, roles: { create: { role: "compliance_officer" } } } });
    });

    afterAll(async () => {
      await prisma.invitation.deleteMany({ where: { email: { in: invitationEmailsSeen } } });
    });

    const address = (label: string) => {
      const email = `sinv-${label}-${randomUUID().slice(0, 8)}@example.com`;
      invitationEmailsSeen.push(email);
      return email;
    };
    const propose = async (payload: Record<string, unknown>) => {
      // A reason is required for every new staff proposal (2026-11-16).
      const action = await service.propose({ permissionKey: "staff.invite", payload: { reason: "Confirmed by phone with the person on 16 November.", ...payload }, makerUserId: adminUserId });
      governedActionIds.push(action.id);
      return action;
    };

    test("approve → invitation for the proposer, audit-logged without its token, emailed after commit", async () => {
      const email = address("approve");
      const action = await propose({ email: email.toUpperCase(), staffRole: "board_of_trustees" });
      expect(await prisma.invitation.count({ where: { email } })).toBe(0);

      await service.decide({ governedActionId: action.id, checkerUserId: complianceUserId, approve: true });

      const invitation = await prisma.invitation.findFirstOrThrow({ where: { email } });
      expect(invitation).toMatchObject({
        inviteeKind: "birr_staff",
        roleKey: "board_of_trustees",
        invitedBy: adminUserId,
        status: "pending",
      });
      const log = await prisma.auditLog.findFirst({ where: { entityId: invitation.id, action: "invitation.sent" } });
      expect(log?.actorUserId).toBe(complianceUserId);
      expect(JSON.stringify(log?.after)).not.toContain(invitation.token);

      // Delivery is fire-and-forget after the commit.
      let delivered = false;
      for (let i = 0; i < 20 && !delivered; i++) {
        delivered = invitationEmails.sent.some((m) => m.to === email && m.link.includes(invitation.token));
        if (!delivered) await new Promise((r) => setTimeout(r, 100));
      }
      expect(delivered).toBe(true);
    });

    test("reject → no invitation is created", async () => {
      const email = address("reject");
      const action = await propose({ email, staffRole: "legal_adviser" });
      await service.decide({ governedActionId: action.id, checkerUserId: complianceUserId, approve: false });
      expect(await prisma.invitation.count({ where: { email } })).toBe(0);
    });

    test("the proposer cannot approve their own invitation, and the database refuses it too", async () => {
      const action = await propose({ email: address("self"), staffRole: "board_of_trustees" });
      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: adminUserId, approve: true }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: adminUserId } }),
      ).rejects.toThrow();
    });

    test("propose() rejects a bad email, an unknown role, an existing account and a pending invitation", async () => {
      await expect(propose({ email: "not-an-email", staffRole: "legal_adviser" })).rejects.toThrow(BadRequestException);
      await expect(propose({ email: address("role"), staffRole: "superuser" })).rejects.toThrow(BadRequestException);

      const existing = await prisma.user.create({ data: { email: address("existing"), fullName: "Already Has An Account" } });
      await expect(propose({ email: existing.email, staffRole: "legal_adviser" })).rejects.toThrow(ConflictException);

      const pendingEmail = address("pending");
      const first = await propose({ email: pendingEmail, staffRole: "legal_adviser" });
      await service.decide({ governedActionId: first.id, checkerUserId: complianceUserId, approve: true });
      await expect(propose({ email: pendingEmail, staffRole: "audit_committee" })).rejects.toThrow(ConflictException);
    });

    test("a second pending proposal for the same email, in any letter case, is a duplicate", async () => {
      const email = address("dup");
      await propose({ email, staffRole: "legal_adviser" });
      await expect(propose({ email: email.toUpperCase(), staffRole: "audit_committee" })).rejects.toThrow(ConflictException);
    });

    test("approval re-checks: an account created after proposing makes approval fail and creates nothing", async () => {
      const email = address("race");
      const action = await propose({ email, staffRole: "legal_adviser" });
      await prisma.user.create({ data: { email, fullName: "Signed Up In The Meantime" } });

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: complianceUserId, approve: true }),
      ).rejects.toThrow(ConflictException);
      expect(await prisma.invitation.count({ where: { email } })).toBe(0);
      expect((await prisma.governedAction.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("proposed");
    });
  });
  // staff.role_add / staff.role_remove (2026-10-18) — a staff member may
  // hold several roles. Maker: platform_admin; checkers: board_of_trustees /
  // compliance_officer. Nobody proposes or approves changes to their own
  // roles; external_auditor stands alone; the last active platform_admin
  // keeps that role.
  // staff.suspend / staff.reinstate (2026-11-15): same two-person rule as
  // role changes. Suspension takes effect on the person's next request,
  // and may never lock a governed action out.
  describe("staff.suspend / staff.reinstate", () => {
    let adminUserId: string;
    let complianceUserId: string;

    async function staffWith(label: string, ...roles: BirrStaffRole[]) {
      const user = await prisma.user.create({
        data: { email: `suspend-${label}-${randomUUID().slice(0, 8)}@example.com`, fullName: `Suspend ${label}` },
      });
      const staff = await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: roles.map((role) => ({ role })) } } });
      return { user, staff };
    }
    const propose = async (kind: "suspend" | "reinstate", staffId: string, makerUserId = adminUserId, reason = "Left Birr on 14 November; access no longer needed.") => {
      const action = await service.propose({ permissionKey: `staff.${kind}`, payload: { staffId, reason }, makerUserId });
      governedActionIds.push(action.id);
      return action;
    };

    beforeAll(async () => {
      adminUserId = (await staffWith("admin", "platform_admin")).user.id;
      complianceUserId = (await staffWith("compliance", "compliance_officer")).user.id;
    }, 30000);

    test("suspend → refused on their next request; reinstate → back in; both audited with the reason and approver", async () => {
      const { user, staff } = await staffWith("leaver", "legal_adviser");
      const request = { cookies: { [STAFF_SESSION_COOKIE_NAME]: signSessionToken(user.id) } } as unknown as Request;
      await expect(resolveBirrStaffFromSession(request, { requireMfa: false })).resolves.toMatchObject({ id: staff.id });

      const suspend = await propose("suspend", staff.id);
      await service.decide({ governedActionId: suspend.id, checkerUserId: complianceUserId, approve: true });
      expect((await prisma.birrStaff.findUniqueOrThrow({ where: { id: staff.id } })).status).toBe("suspended");
      await expect(resolveBirrStaffFromSession(request, { requireMfa: false })).rejects.toThrow();
      const suspended = await prisma.auditLog.findFirstOrThrow({ where: { entityId: staff.id, action: "birr_staff.suspended" } });
      expect(suspended.after).toMatchObject({ status: "suspended", reason: "Left Birr on 14 November; access no longer needed.", approvedByUserId: complianceUserId });

      const reinstate = await propose("reinstate", staff.id, adminUserId, "Rejoined Birr; reinstating access.");
      await service.decide({ governedActionId: reinstate.id, checkerUserId: complianceUserId, approve: true });
      await expect(resolveBirrStaffFromSession(request, { requireMfa: false })).resolves.toMatchObject({ id: staff.id });
      expect(await prisma.auditLog.count({ where: { entityId: staff.id, action: "birr_staff.reinstated" } })).toBe(1);
    });

    test("nobody suspends themselves, nor approves their own suspension", async () => {
      const admin2 = await staffWith("admin2", "platform_admin");
      await expect(propose("suspend", admin2.staff.id, admin2.user.id)).rejects.toThrow(ForbiddenException);
      const target = await staffWith("own-approve", "compliance_officer");
      const action = await propose("suspend", target.staff.id);
      await expect(service.decide({ governedActionId: action.id, checkerUserId: target.user.id, approve: true })).rejects.toThrow(ForbiddenException);
    });

    test("the proposer cannot approve it, and the database refuses it too", async () => {
      const { staff } = await staffWith("maker-checker", "legal_adviser");
      const action = await propose("suspend", staff.id);
      await expect(service.decide({ governedActionId: action.id, checkerUserId: adminUserId, approve: true })).rejects.toThrow(ForbiddenException);
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: adminUserId } })).rejects.toThrow();
    });

    test("needs a real reason, and only one change per person can be pending", async () => {
      const { staff } = await staffWith("pending", "legal_adviser", "audit_committee");
      await expect(propose("suspend", staff.id, adminUserId, "gone")).rejects.toThrow(BadRequestException);
      await propose("suspend", staff.id);
      await expect(
        service.propose({ permissionKey: "staff.role_remove", payload: { staffId: staff.id, role: "audit_committee", reason: "Confirmed by phone with the person on 16 November." }, makerUserId: adminUserId }),
      ).rejects.toThrow(ConflictException);
      await expect(propose("reinstate", staff.id)).rejects.toThrow();
    });

    test("never leaves a governed action with nobody active able to approve it", async () => {
      // Built inside a transaction that is rolled back: a throwaway
      // approval action only legal_adviser may approve, and every other
      // legal adviser suspended, so the one left can't be suspended.
      const { staff } = await staffWith("last-approver", "legal_adviser");
      const target = { id: staff.id, user: { fullName: "Suspend last-approver" }, roleList: ["legal_adviser"] as BirrStaffRole[] };
      const rollback = new Error("rollback");
      await expect(
        prisma.$transaction(async (tx) => {
          const role = await tx.role.findUniqueOrThrow({ where: { key: "legal_adviser" } });
          const permission = await tx.permission.create({
            data: { key: `test.lockout_${randomUUID().slice(0, 8)}`, requiresMakerChecker: true, description: "test only" },
          });
          await tx.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id, canChecker: true } });
          await tx.birrStaff.updateMany({
            where: { id: { not: staff.id }, status: "active", roles: { some: { role: "legal_adviser" } } },
            data: { status: "suspended" },
          });
          await expect(assertSuspensionAllowed(target, tx)).rejects.toThrow(/nobody active able to approve test\.lockout_/);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    }, 30000);
  });

  // founder.primary_contact_change (2026-11-15): a Founder's primary
  // contact asks, or a Mutawalli Officer records an unreachable contact
  // with evidence; Compliance or the Board approves.
  describe("founder.primary_contact_change", () => {
    let officerUserId: string;
    let complianceUserId: string;
    const successionService = new FounderSuccessionService(notificationsService, new SettingsService(new EncryptionService()));
    const founderIds: string[] = [];

    async function staffWith(label: string, role: BirrStaffRole) {
      const user = await prisma.user.create({ data: { email: `succ-ga-${label}-${randomUUID().slice(0, 8)}@example.com`, fullName: `Succession ${label}` } });
      await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role } } } });
      return user;
    }
    async function founderWithTeam() {
      const founder = await prisma.founder.create({ data: { name: `Succession GA ${randomUUID().slice(0, 6)}`, kind: "institution" } });
      founderIds.push(founder.id);
      const mk = (label: string) => prisma.user.create({ data: { email: `succ-ga-${label}-${randomUUID().slice(0, 8)}@example.com`, fullName: `Member ${label}`, status: "active" } });
      const contactUser = await mk("contact");
      const memberUser = await mk("member");
      const contact = await prisma.founderMembership.create({ data: { founderId: founder.id, userId: contactUser.id, permissionLevel: "primary_contact" } });
      const member = await prisma.founderMembership.create({ data: { founderId: founder.id, userId: memberUser.id, permissionLevel: "viewer" } });
      return { founder, contactUser, contact, member };
    }
    const propose = async (successionId: string, makerUserId = officerUserId) => {
      const action = await service.propose({ permissionKey: "founder.primary_contact_change", payload: { successionId }, makerUserId });
      governedActionIds.push(action.id);
      return action;
    };

    beforeAll(async () => {
      officerUserId = (await staffWith("officer", "mutawalli_officer")).id;
      complianceUserId = (await staffWith("compliance", "compliance_officer")).id;
    }, 30000);

    afterAll(async () => {
      await prisma.primaryContactSuccession.updateMany({ where: { founderId: { in: founderIds }, status: { in: ["requested", "approved", "objected"] } }, data: { status: "cancelled" } });
    });

    test("propose and approve swaps the primary contact; the case is linked to the approval", async () => {
      const { founder, contactUser, contact, member } = await founderWithTeam();
      const succession = await successionService.requestHandover({ userId: contactUser.id, founderId: founder.id }, { newMembershipId: member.id, reason: "Retiring as Bursar this December." });
      const action = await propose(succession.id);
      await service.decide({ governedActionId: action.id, checkerUserId: complianceUserId, approve: true });
      expect((await prisma.founderMembership.findUniqueOrThrow({ where: { id: member.id } })).permissionLevel).toBe("primary_contact");
      expect((await prisma.founderMembership.findUniqueOrThrow({ where: { id: contact.id } })).permissionLevel).toBe("viewer");
      expect(await prisma.primaryContactSuccession.findUniqueOrThrow({ where: { id: succession.id } })).toMatchObject({ status: "completed", governedActionId: action.id });
    });

    test("the proposer cannot approve it, and the database refuses it too", async () => {
      const { founder, contactUser, member } = await founderWithTeam();
      const succession = await successionService.requestHandover({ userId: contactUser.id, founderId: founder.id }, { newMembershipId: member.id, reason: "Leaving the bank in January." });
      const action = await propose(succession.id);
      await expect(service.decide({ governedActionId: action.id, checkerUserId: officerUserId, approve: true })).rejects.toThrow(ForbiddenException);
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: officerUserId } })).rejects.toThrow();
    });

    test("an objected case can't be proposed, and one case can't be proposed twice", async () => {
      const { founder, contactUser, member } = await founderWithTeam();
      const unreachable = await successionService.recordUnreachable(officerUserId, {
        founderId: founder.id,
        newMembershipId: member.id,
        reason: "Family says the chair is gravely ill.",
        evidenceNote: "Letter from the family dated 10 Nov, filed.",
      });
      await propose(unreachable.id);
      await expect(propose(unreachable.id)).rejects.toThrow(ConflictException);
      await successionService.object(unreachable.id, contactUser.id, { note: "I am recovering and can act." });
      await expect(propose(unreachable.id)).rejects.toThrow(BadRequestException);
    });

    test("rejecting closes the case and leaves the primary contact in place", async () => {
      const { founder, contactUser, contact, member } = await founderWithTeam();
      const succession = await successionService.requestHandover({ userId: contactUser.id, founderId: founder.id }, { newMembershipId: member.id, reason: "Handing over to my deputy." });
      const action = await propose(succession.id);
      await service.decide({ governedActionId: action.id, checkerUserId: complianceUserId, approve: false });
      expect((await prisma.primaryContactSuccession.findUniqueOrThrow({ where: { id: succession.id } })).status).toBe("rejected");
      expect((await prisma.founderMembership.findUniqueOrThrow({ where: { id: contact.id } })).permissionLevel).toBe("primary_contact");
    });
  });

  describe("staff.role_add / staff.role_remove", () => {
    let adminUserId: string;
    let adminStaffId: string;
    let complianceUserId: string;
    let complianceStaffId: string;

    async function staffWith(label: string, ...roles: BirrStaffRole[]) {
      const user = await prisma.user.create({
        data: { email: `roles-${label}-${randomUUID().slice(0, 8)}@example.com`, fullName: `Roles ${label}` },
      });
      const staff = await prisma.birrStaff.create({
        data: { userId: user.id, roles: { create: roles.map((role) => ({ role })) } },
      });
      return { user, staff };
    }
    const rolesOf = async (staffId: string) =>
      (await prisma.birrStaffRoleGrant.findMany({ where: { birrStaffId: staffId }, orderBy: { role: "asc" } })).map((g) => g.role);
    const propose = async (kind: "add" | "remove", staffId: string, role: BirrStaffRole, makerUserId = adminUserId) => {
      const action = await service.propose({ permissionKey: `staff.role_${kind}`, payload: { staffId, role, reason: "Confirmed by phone with the person on 16 November." }, makerUserId });
      governedActionIds.push(action.id);
      return action;
    };

    beforeAll(async () => {
      const admin = await staffWith("admin", "platform_admin");
      adminUserId = admin.user.id;
      adminStaffId = admin.staff.id;
      const compliance = await staffWith("compliance", "compliance_officer");
      complianceUserId = compliance.user.id;
      complianceStaffId = compliance.staff.id;
    }, 30000);

    test("add → the role is granted, audit-logged with before/after, and the person is notified", async () => {
      const { user, staff } = await staffWith("add", "legal_adviser");
      const action = await propose("add", staff.id, "compliance_officer");
      await service.decide({ governedActionId: action.id, checkerUserId: complianceUserId, approve: true });

      expect(await rolesOf(staff.id)).toEqual(["compliance_officer", "legal_adviser"]);
      const log = await prisma.auditLog.findFirst({ where: { entityId: staff.id, action: "birr_staff.role_added" } });
      expect(log?.before).toEqual({ roles: ["legal_adviser"] });
      expect(log?.after).toMatchObject({ roles: ["compliance_officer", "legal_adviser"], approvedByUserId: complianceUserId });
      let notice = null;
      for (let i = 0; i < 20 && !notice; i++) {
        notice = await prisma.notification.findFirst({ where: { recipientUserId: user.id, type: "birr_staff.roles_changed" } });
        if (!notice) await new Promise((r) => setTimeout(r, 100));
      }
      expect(notice).not.toBeNull();
    });

    // 2026-11-16: every staff change carries the proposer's reason, shown
    // to whoever approves it and kept in the audit trail.
    test("a reason is required to propose a role change, an invitation or a two-factor reset, and it reaches the approver and the audit row", async () => {
      const { staff } = await staffWith("reason", "legal_adviser");
      await expect(service.propose({ permissionKey: "staff.role_add", payload: { staffId: staff.id, role: "audit_committee" }, makerUserId: adminUserId })).rejects.toThrow(/Give a reason/);
      await expect(service.propose({ permissionKey: "staff.role_remove", payload: { staffId: staff.id, role: "legal_adviser", reason: "short" }, makerUserId: adminUserId })).rejects.toThrow(/Give a reason/);
      await expect(service.propose({ permissionKey: "staff.invite", payload: { email: `reason-${randomUUID().slice(0, 8)}@example.com`, staffRole: "legal_adviser" }, makerUserId: adminUserId })).rejects.toThrow(/Give a reason/);
      await expect(service.propose({ permissionKey: "staff.mfa_reset", payload: { staffId: staff.id }, makerUserId: adminUserId })).rejects.toThrow(/Give a reason/);

      const action = await propose("add", staff.id, "audit_committee");
      const listed = (await service.list({ status: "proposed" })).find((a) => a.id === action.id);
      expect(listed?.summary).toContain('Reason: "Confirmed by phone with the person on 16 November."');
      await service.decide({ governedActionId: action.id, checkerUserId: complianceUserId, approve: true });
      const log = await prisma.auditLog.findFirst({ where: { entityId: staff.id, action: "birr_staff.role_added" } });
      expect(log?.after).toMatchObject({ reason: "Confirmed by phone with the person on 16 November." });
    }, 30000);

    test("a role change proposed before reasons were required can still be approved", async () => {
      const { staff } = await staffWith("legacy", "legal_adviser");
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "staff.role_add" } });
      const legacy = await prisma.governedAction.create({
        data: { permissionId: permission.id, makerType: "human", makerUserId: adminUserId, status: "proposed", payload: { staffId: staff.id, role: "audit_committee" } },
      });
      governedActionIds.push(legacy.id);
      await service.decide({ governedActionId: legacy.id, checkerUserId: complianceUserId, approve: true });
      expect(await rolesOf(staff.id)).toEqual(["audit_committee", "legal_adviser"]);
    });

    test("remove → the role is taken away", async () => {
      const { staff } = await staffWith("remove", "legal_adviser", "audit_committee");
      const action = await propose("remove", staff.id, "audit_committee");
      await service.decide({ governedActionId: action.id, checkerUserId: complianceUserId, approve: true });
      expect(await rolesOf(staff.id)).toEqual(["legal_adviser"]);
    });

    test("the proposer cannot approve it, and the database refuses it too", async () => {
      const { staff } = await staffWith("self-approve", "legal_adviser");
      const action = await propose("add", staff.id, "audit_committee");
      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: adminUserId, approve: true }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: adminUserId } }),
      ).rejects.toThrow();
    });

    test("nobody can propose a change to their own roles", async () => {
      await expect(propose("add", adminStaffId, "legal_adviser")).rejects.toThrow(ForbiddenException);
    });

    test("nobody can approve a change to their own roles", async () => {
      const action = await propose("add", complianceStaffId, "legal_adviser");
      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: complianceUserId, approve: true }),
      ).rejects.toThrow(ForbiddenException);
      expect(await rolesOf(complianceStaffId)).toEqual(["compliance_officer"]);
    });

    test("external_auditor stands alone, in both directions", async () => {
      const { staff: auditor } = await staffWith("auditor", "external_auditor");
      await expect(propose("add", auditor.id, "legal_adviser")).rejects.toThrow(BadRequestException);
      const { staff: legal } = await staffWith("legal", "legal_adviser");
      await expect(propose("add", legal.id, "external_auditor")).rejects.toThrow(BadRequestException);
    });

    test("can't add a role already held, remove one not held, or remove someone's only role", async () => {
      const { staff } = await staffWith("rules", "legal_adviser");
      await expect(propose("add", staff.id, "legal_adviser")).rejects.toThrow(ConflictException);
      await expect(propose("remove", staff.id, "audit_committee")).rejects.toThrow(BadRequestException);
      await expect(propose("remove", staff.id, "legal_adviser")).rejects.toThrow(BadRequestException);
    });

    test("a second pending change for the same person is a duplicate", async () => {
      const { staff } = await staffWith("dup", "legal_adviser");
      await propose("add", staff.id, "audit_committee");
      await expect(propose("add", staff.id, "board_of_trustees")).rejects.toThrow(ConflictException);
    });

    test("removing platform_admin from one of several admins goes through the approval", async () => {
      const { staff } = await staffWith("extra-admin", "platform_admin", "legal_adviser");
      const action = await propose("remove", staff.id, "platform_admin");
      await service.decide({ governedActionId: action.id, checkerUserId: complianceUserId, approve: true });
      expect(await rolesOf(staff.id)).toEqual(["legal_adviser"]);
    });

    test("the last active platform_admin keeps that role", async () => {
      const { staff } = await staffWith("last-admin", "platform_admin", "legal_adviser");
      const target = {
        id: staff.id,
        user: { fullName: "Roles last-admin" },
        roleList: ["legal_adviser", "platform_admin"] as BirrStaffRole[],
      };
      // Rolled back: with every other admin suspended, this is the last one.
      class Rollback extends Error {}
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.birrStaff.updateMany({
            where: { id: { not: staff.id }, status: "active", roles: { some: { role: "platform_admin" } } },
            data: { status: "suspended" },
          });
          await expect(assertRoleChangeAllowed("remove", target, "platform_admin", tx)).rejects.toThrow(/last active platform_admin/);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
      // Outside that transaction other admins exist, so it's allowed.
      await expect(assertRoleChangeAllowed("remove", target, "platform_admin", prisma)).resolves.toBeUndefined();
    });
  });
  // A proposal saved before its handler's payload shape changed (found
  // 2026-10-18: a vault.cause_allocate proposal from before allocations
  // became per-currency) must not break the Approvals list for everyone.
  test("list() still works when one pending proposal's payload no longer fits its handler", async () => {
    const maker = await prisma.user.create({
      data: { email: `stale-payload-${randomUUID().slice(0, 8)}@example.com`, fullName: "Stale Payload Maker" },
    });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "vault.cause_allocate" } });
    const stale = await prisma.governedAction.create({
      data: {
        permissionId: permission.id,
        makerType: "human",
        makerUserId: maker.id,
        status: "proposed",
        payload: { vaultCauseId: randomUUID(), newAllocatedAmount: "100" }, // no currency
      },
    });
    governedActionIds.push(stale.id);

    // How a stale payload fails depends on the handler and the data, so
    // make this one fail the way a stale payload can: by throwing.
    const handler = (service as unknown as { handlers: Map<string, Record<string, unknown>> }).handlers.get("vault.cause_allocate")!;
    const describeSpy = jest.spyOn(handler as { describePayload: () => Promise<string> }, "describePayload").mockRejectedValue(new Error("stale"));
    const stateSpy = jest.spyOn(handler as { describeCurrentState: () => Promise<unknown> }, "describeCurrentState").mockRejectedValue(new Error("stale"));
    try {
      const listed = await service.list({ status: "proposed" });
      expect(listed.find((a) => a.id === stale.id)?.summary).toBeNull();
      expect((await service.findById(stale.id))?.currentState).toBeNull();
    } finally {
      describeSpy.mockRestore();
      stateSpy.mockRestore();
    }
  }, 30000);

  // role.permission_change (2026-10-18) — editing what a role may do from
  // the Ops Console. Maker: platform_admin; checker: board_of_trustees
  // only. Guard rails: no lock-outs, no role both proposes and approves,
  // external_auditor stays read-only on approval actions.
  describe("role.permission_change", () => {
    let adminUserId: string;
    let boardUserId: string;

    beforeAll(async () => {
      const make = async (label: string, role: BirrStaffRole) => {
        const user = await prisma.user.create({
          data: { email: `grants-${label}-${randomUUID().slice(0, 8)}@example.com`, fullName: `Grants ${label}` },
        });
        await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role } } } });
        return user.id;
      };
      adminUserId = await make("admin", "platform_admin");
      boardUserId = await make("board", "board_of_trustees");
    }, 30000);

    const REASON = "Needed for the quarterly access review.";
    const proposeRaw = async (payload: Record<string, unknown>) => {
      const action = await service.propose({ permissionKey: "role.permission_change", payload, makerUserId: adminUserId });
      governedActionIds.push(action.id);
      return action;
    };
    // Since 2026-11-16 a proposal is a batch with a reason.
    const propose = (...changes: Record<string, unknown>[]) => proposeRaw({ changes, reason: REASON });
    const change = (roleKey: string, permissionKey: string, canMaker: boolean, canChecker = false) => ({
      roleKey,
      permissionKey,
      canMaker,
      canChecker,
    });
    const grantRow = async (roleKey: string, permissionKey: string) => {
      const [role, permission] = await Promise.all([
        prisma.role.findUniqueOrThrow({ where: { key: roleKey } }),
        prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } }),
      ]);
      return { role, permission, where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } };
    };

    test("approve → the grant changes, takes effect at once, and is audit-logged with before/after and the reason", async () => {
      const { role, permission, where } = await grantRow("legal_adviser", "vault.expense_record");
      expect(await prisma.rolePermission.findUnique({ where })).toBeNull();
      try {
        const action = await propose(change("legal_adviser", "vault.expense_record", true));
        await service.decide({ governedActionId: action.id, checkerUserId: boardUserId, approve: true });

        expect(await prisma.rolePermission.findUniqueOrThrow({ where })).toMatchObject({ canMaker: true, canChecker: false });
        expect(await staffHasAccess({ roles: ["legal_adviser"] }, "vault.expense_record")).toBe(true);
        const log = await prisma.auditLog.findFirst({
          where: { action: "role_permission.changed", entityId: permission.id },
          orderBy: { createdAt: "desc" },
        });
        expect(log?.before).toMatchObject({ roleKey: "legal_adviser", canMaker: false });
        expect(log?.after).toMatchObject({
          roleKey: "legal_adviser", canMaker: true, approvedByUserId: boardUserId, proposedByUserId: adminUserId, reason: REASON, governedActionId: action.id,
        });
      } finally {
        // Shared test database — put the grant back as it was (no row).
        await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
      }
    });

    test("a batch is approved as a whole, with one audit row per change", async () => {
      const a = await grantRow("legal_adviser", "vault.milestone_manage");
      const b = await grantRow("audit_committee", "vault.expense_record");
      try {
        const action = await propose(change("legal_adviser", "vault.milestone_manage", true), change("audit_committee", "vault.expense_record", true));
        await service.decide({ governedActionId: action.id, checkerUserId: boardUserId, approve: true });
        expect(await prisma.rolePermission.findUniqueOrThrow({ where: a.where })).toMatchObject({ canMaker: true });
        expect(await prisma.rolePermission.findUniqueOrThrow({ where: b.where })).toMatchObject({ canMaker: true });
        const logs = await prisma.auditLog.findMany({ where: { action: "role_permission.changed", after: { path: ["governedActionId"], equals: action.id } } });
        expect(logs).toHaveLength(2);
      } finally {
        await prisma.rolePermission.deleteMany({ where: { OR: [a.where.roleId_permissionId, b.where.roleId_permissionId] } });
      }
    });

    test("lock-outs are judged on the batch's end state: moving the only approver works in one batch, not as a lone removal", async () => {
      // role.permission_change: only the Board approves it.
      await expect(propose(change("board_of_trustees", "role.permission_change", false))).rejects.toThrow(/nobody active able to approve/);
      const { checks } = await new (await import("../roles/roles.service")).RolesService().preview([
        change("board_of_trustees", "role.permission_change", false),
        change("compliance_officer", "role.permission_change", false, true),
      ]);
      expect(checks.map((c) => c.problem)).toEqual([null, null]);
    });

    test("a new proposal needs a reason, and a batch can't repeat a change or exceed 50", async () => {
      await expect(proposeRaw({ changes: [change("legal_adviser", "vault.curate", true)] })).rejects.toThrow(/Say why/);
      await expect(proposeRaw({ changes: [change("legal_adviser", "vault.curate", true)], reason: "too short" })).rejects.toThrow(/Say why/);
      await expect(propose(change("legal_adviser", "vault.curate", true), change("legal_adviser", "vault.curate", false))).rejects.toThrow(/appears twice/);
      const many = Array.from({ length: 51 }, (_, i) => change("legal_adviser", `p${i}`, true));
      await expect(propose(...many)).rejects.toThrow(/At most 50/);
    });

    test("a proposal from before batches (one change, no reason) is still approvable", async () => {
      const { role, permission, where } = await grantRow("legal_adviser", "vault.investment_create");
      try {
        // Straight into the table, as one made before 2026-11-16 would be.
        const permissionRow = await prisma.permission.findUniqueOrThrow({ where: { key: "role.permission_change" } });
        const legacy = await prisma.governedAction.create({
          data: {
            permissionId: permissionRow.id, makerType: "human", makerUserId: adminUserId, status: "proposed",
            payload: change("legal_adviser", "vault.investment_create", true),
          },
        });
        governedActionIds.push(legacy.id);
        await service.decide({ governedActionId: legacy.id, checkerUserId: boardUserId, approve: true });
        expect(await prisma.rolePermission.findUniqueOrThrow({ where })).toMatchObject({ canMaker: true });
      } finally {
        await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
      }
    });

    test("the proposer cannot approve it, and the database refuses it too", async () => {
      const action = await propose(change("legal_adviser", "vault.milestone_manage", true));
      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: adminUserId, approve: true }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: adminUserId } }),
      ).rejects.toThrow();
    });

    test("no role may both propose and approve the same approval action", async () => {
      await expect(propose(change("mutawalli_officer", "distribution.approve", true, true))).rejects.toThrow(BadRequestException);
    });

    test("the External Auditor stays read-only on approval actions", async () => {
      await expect(propose(change("external_auditor", "asset.dispose", false, true))).rejects.toThrow(/External Auditor/);
    });

    test("a plain permission has no approve side, and a no-op change is refused", async () => {
      await expect(propose(change("mutawalli_officer", "vault.curate", true, true))).rejects.toThrow(BadRequestException);
      await expect(propose(change("mutawalli_officer", "vault.curate", true))).rejects.toThrow(/already has exactly that/);
    });

    test("no lock-outs: an approval action always keeps someone able to propose it and someone able to approve it", async () => {
      // The Board is the only approver of this editor itself…
      await expect(propose(change("board_of_trustees", "role.permission_change", false))).rejects.toThrow(/nobody active able to approve/);
      // …and the Platform Admin the only proposer of adding staff.
      await expect(propose(change("platform_admin", "staff.invite", false))).rejects.toThrow(/nobody active able to propose/);
    });

    test("a change overlapping one already awaiting approval is a duplicate", async () => {
      await propose(change("audit_committee", "vault.structuring_review", false));
      await expect(
        propose(change("legal_adviser", "vault.curate", true), change("audit_committee", "vault.structuring_review", false)),
      ).rejects.toThrow(ConflictException);
    });

    test("a change to the Board's own permissions says so plainly to the approver, with the reason", async () => {
      const action = await propose(change("board_of_trustees", "vault.structuring_review", false));
      // list() summarizes every pending proposal in the shared test
      // database, so give it room under a full parallel run.
      const listed = (await service.list({ status: "proposed" })).find((a) => a.id === action.id);
      expect(listed?.summary).toMatch(/Board of Trustees' own permissions/);
      expect(listed?.summary).toContain(`Reason: "${REASON}"`);
    }, 30000);
  });
  // founder.mfa_reset (2026-10-01) — the Founder Portal counterpart of
  // staff.mfa_reset. Maker: platform_admin; checkers: board_of_trustees /
  // compliance_officer. The Founder is notified when it lands.
  describe("founder.mfa_reset", () => {
    let adminUserId: string;
    let boardUserId: string;

    beforeAll(async () => {
      const admin = await prisma.user.create({
        data: { email: `fmfa-admin-${Date.now()}@example.com`, fullName: "Founder MFA Request Admin" },
      });
      adminUserId = admin.id;
      await prisma.birrStaff.create({ data: { userId: admin.id, roles: { create: { role: "platform_admin" } } } });
      const board = await prisma.user.create({
        data: { email: `fmfa-board-${Date.now()}@example.com`, fullName: "Founder MFA Approving Board" },
      });
      boardUserId = board.id;
      await prisma.birrStaff.create({ data: { userId: board.id, roles: { create: { role: "board_of_trustees" } } } });
    });

    async function enrolledFounderUser(label: string) {
      const user = await prisma.user.create({
        data: {
          email: `fmfa-target-${label}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`,
          fullName: `Founder MFA Target ${label}`,
          mfaEnabled: true,
          mfaSecretEncrypted: "not-a-real-secret",
        },
      });
      await prisma.mfaBackupCode.create({ data: { userId: user.id, codeHash: "x" } });
      return user;
    }

    const propose = (userId: string) =>
      service.propose({ permissionKey: "founder.mfa_reset", payload: { userId }, makerUserId: adminUserId });

    test("approve → MFA cleared, audit-logged by the engine, the Founder is notified without staff names", async () => {
      const user = await enrolledFounderUser("approve");
      const action = await propose(user.id);
      governedActionIds.push(action.id);

      // Nothing changes on propose — a second person has to approve first.
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(true);

      await service.decide({ governedActionId: action.id, checkerUserId: boardUserId, approve: true });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.mfaEnabled).toBe(false);
      expect(after.mfaSecretEncrypted).toBeNull();
      expect(await prisma.mfaBackupCode.count({ where: { userId: user.id } })).toBe(0);

      const logs = await prisma.auditLog.findMany({ where: { entityId: user.id, action: "founder.mfa_reset" } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId: boardUserId });

      let notice = null;
      for (let i = 0; i < 20 && !notice; i++) {
        notice = await prisma.notification.findFirst({ where: { recipientUserId: user.id, type: "founder.mfa_reset" } });
        if (!notice) await new Promise((r) => setTimeout(r, 100));
      }
      expect(notice).not.toBeNull();
      expect(notice!.recipientType).toBe("founder_user");
      expect(notice!.body).not.toContain("Founder MFA Request Admin");
      expect(notice!.body).not.toContain("Founder MFA Approving Board");
    });

    test("reject → MFA is left exactly as it was, and nobody is told it was reset", async () => {
      const user = await enrolledFounderUser("reject");
      const action = await propose(user.id);
      governedActionIds.push(action.id);

      await service.decide({ governedActionId: action.id, checkerUserId: boardUserId, approve: false });

      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(true);
      expect(await prisma.notification.count({ where: { recipientUserId: user.id, type: "founder.mfa_reset" } })).toBe(0);
    });

    test("the proposer cannot approve their own request, and the database refuses it too", async () => {
      const user = await enrolledFounderUser("self");
      const action = await propose(user.id);
      governedActionIds.push(action.id);

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: adminUserId, approve: true }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: adminUserId } }),
      ).rejects.toThrow();
    });

    test("propose() rejects an unknown user, an unenrolled user, and a Birr staff account (which has its own action)", async () => {
      await expect(propose(randomUUID())).rejects.toThrow();

      const unenrolled = await enrolledFounderUser("not-enrolled");
      await prisma.user.update({ where: { id: unenrolled.id }, data: { mfaEnabled: false, mfaSecretEncrypted: null } });
      await expect(propose(unenrolled.id)).rejects.toThrow(BadRequestException);

      await expect(propose(boardUserId)).rejects.toThrow(/staff member/);
    });

    test("a second pending request for the same Founder user is rejected as a duplicate", async () => {
      const user = await enrolledFounderUser("dup");
      const first = await propose(user.id);
      governedActionIds.push(first.id);
      await expect(propose(user.id)).rejects.toThrow(ConflictException);
    });
  });

  // zakah.ruleset_approve / zakah.metal_price_set (2026-11-11). Rulesets:
  // maker mutawalli_officer (makerUserId), checker shariah_board_member
  // (beneficiaryCheckerUserId). Prices: maker investment_committee
  // (investmentMakerUserId), checker compliance_officer
  // (distributionCheckerUserId). Deliberately not added to
  // governedActionIds: an approved zakah row references its governed
  // action (ON DELETE RESTRICT), and both zakah tables are append-only, so
  // these fixtures stay behind — harmless, per zakah.service.spec.ts.
  // clinic_waqf.deed_approve / clinic_waqf.establish (2026-11-17). Maker
  // mutawalli_officer (makerUserId); the deed's checker is a Shariah board
  // member only (beneficiaryCheckerUserId), establishing's the Board only
  // (boardCheckerUserId). Clinic waqfs and their deeds are never deleted,
  // so these fixtures stay behind and their actions aren't cleaned up.
  describe("clinic waqf", () => {
    const clinics = new ClinicWaqfsService();
    const newClinic = () =>
      clinics.create(
        { name: "Governed Test Clinic", slug: `ga-clinic-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" },
        makerUserId,
      );
    const proposeDeed = (deed: { id: string; textHash: string }) =>
      service.propose({ permissionKey: "clinic_waqf.deed_approve", payload: { deedId: deed.id, textHash: deed.textHash }, makerUserId });

    // The checker's role is enforced by PermissionGuard on POST
    // /governed-actions/:id/decide, from these grants.
    test("only a Shariah board member may approve a deed, and only the Board may establish", async () => {
      const checkers = async (key: string) =>
        (
          await prisma.rolePermission.findMany({
            where: { permission: { key }, canChecker: true },
            select: { role: { select: { key: true } } },
          })
        ).map((g) => g.role.key);
      expect(await checkers("clinic_waqf.deed_approve")).toEqual(["shariah_board_member"]);
      expect(await checkers("clinic_waqf.establish")).toEqual(["board_of_trustees"]);
    });

    test("clinic_waqf.deed_approve: approving makes it the live version; a later version supersedes it", async () => {
      const clinic = await newClinic();
      const v1 = await clinics.draftDeed(clinic.id, { text: "First wording." }, makerUserId);
      const action = await proposeDeed(v1);
      await service.decide({ governedActionId: action.id, checkerUserId: beneficiaryCheckerUserId, approve: true });

      expect(await prisma.waqfProgrammeDeed.findUniqueOrThrow({ where: { id: v1.id } })).toMatchObject({ status: "approved", approvedActionId: action.id });
      const logs = await prisma.auditLog.findMany({ where: { entityId: v1.id, action: "clinic_waqf_deed.approved" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].actorUserId).toBe(beneficiaryCheckerUserId);

      const v2 = await clinics.draftDeed(clinic.id, { text: "Second wording." }, makerUserId);
      const second = await proposeDeed(v2);
      await expect(proposeDeed(v2)).rejects.toThrow(ConflictException);
      await service.decide({ governedActionId: second.id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      expect((await prisma.waqfProgrammeDeed.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe("superseded");
      expect((await prisma.waqfProgrammeDeed.findUniqueOrThrow({ where: { id: v2.id } })).status).toBe("approved");
    });

    test("clinic_waqf.establish: refused before a deed is approved, then established for good", async () => {
      const clinic = await newClinic();
      await expect(
        service.propose({ permissionKey: "clinic_waqf.establish", payload: { programmeId: clinic.id }, makerUserId }),
      ).rejects.toThrow(/no approved deed/);

      const deed = await clinics.draftDeed(clinic.id, {}, makerUserId);
      await service.decide({ governedActionId: (await proposeDeed(deed)).id, checkerUserId: beneficiaryCheckerUserId, approve: true });

      const action = await service.propose({ permissionKey: "clinic_waqf.establish", payload: { programmeId: clinic.id }, makerUserId });
      await service.decide({ governedActionId: action.id, checkerUserId: boardCheckerUserId, approve: true });

      expect(await prisma.waqfProgramme.findUniqueOrThrow({ where: { id: clinic.id } })).toMatchObject({
        status: "established",
        establishedActionId: action.id,
      });
      expect(await prisma.auditLog.count({ where: { entityId: clinic.id, action: "clinic_waqf.established" } })).toBe(1);
      await expect(
        service.propose({ permissionKey: "clinic_waqf.establish", payload: { programmeId: clinic.id }, makerUserId }),
      ).rejects.toThrow(/already established/);
    });

    test("the database refuses whoever proposed establishing a clinic waqf as its checker", async () => {
      const clinic = await newClinic();
      const deed = await clinics.draftDeed(clinic.id, {}, makerUserId);
      await service.decide({ governedActionId: (await proposeDeed(deed)).id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      const action = await service.propose({ permissionKey: "clinic_waqf.establish", payload: { programmeId: clinic.id }, makerUserId });
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } })).rejects.toThrow();
    });
  });

  // clinic_waqf.asset_add / clinic_waqf.asset_dispose (slice 5a). Maker
  // mutawalli_officer (makerUserId), checker the Board (boardCheckerUserId).
  // Assets and the ledger are never deleted, so these fixtures stay behind.
  describe("clinic waqf assets", () => {
    const clinics = new ClinicWaqfsService();
    const assets = new ClinicAssetsService(new ClinicLedgerService());

    async function establishedClinic() {
      const clinic = await clinics.create(
        { name: "Asset Test Clinic", slug: `asset-clinic-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" },
        makerUserId,
      );
      const deed = await clinics.draftDeed(clinic.id, {}, makerUserId);
      const approveDeed = await service.propose({ permissionKey: "clinic_waqf.deed_approve", payload: { deedId: deed.id, textHash: deed.textHash }, makerUserId });
      await service.decide({ governedActionId: approveDeed.id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      const establish = await service.propose({ permissionKey: "clinic_waqf.establish", payload: { programmeId: clinic.id }, makerUserId });
      await service.decide({ governedActionId: establish.id, checkerUserId: boardCheckerUserId, approve: true });
      return clinic;
    }

    const land = (programmeId: string) =>
      assets.record(
        programmeId,
        { kind: "land", name: "Plot at Bodija", value: "45000000", valuationNote: "Valued by a registered estate valuer; C of O inspected.", donorName: "The Adeyemi family", acquiredOn: "2026-11-01" },
        makerUserId,
      );

    const lines = async (sourceId: string, source: "asset_added" | "asset_disposed") =>
      (await prisma.programmeJournalEntry.findMany({ where: { source, sourceId }, include: { lines: { include: { ledgerAccount: true } } } }))
        .flatMap((e) => e.lines)
        .map((l) => [l.ledgerAccount.code, l.debit.toFixed(2), l.credit.toFixed(2)])
        .sort();

    test("only the Board approves adding or disposing of a clinic asset", async () => {
      for (const key of ["clinic_waqf.asset_add", "clinic_waqf.asset_dispose"]) {
        const grants = await prisma.rolePermission.findMany({ where: { permission: { key }, canChecker: true }, select: { role: { select: { key: true } } } });
        expect(grants.map((g) => g.role.key)).toEqual(["board_of_trustees"]);
      }
    });

    test("a gift in kind joins the endowment at its valuation once the Board approves, booked once", async () => {
      const clinic = await establishedClinic();
      const asset = await land(clinic.id);
      expect(asset.status).toBe("proposed");
      expect(await prisma.auditLog.count({ where: { entityId: asset.id, action: "clinic_asset.recorded" } })).toBe(1);

      const action = await service.propose({ permissionKey: "clinic_waqf.asset_add", payload: { assetId: asset.id }, makerUserId });
      await expect(service.propose({ permissionKey: "clinic_waqf.asset_add", payload: { assetId: asset.id }, makerUserId })).rejects.toThrow(ConflictException);
      await service.decide({ governedActionId: action.id, checkerUserId: boardCheckerUserId, approve: true });

      expect(await prisma.programmeAsset.findUniqueOrThrow({ where: { id: asset.id } })).toMatchObject({ status: "active", approvalActionId: action.id });
      expect(await lines(asset.id, "asset_added")).toEqual([
        ["1500", "45000000.00", "0.00"],
        ["3000", "0.00", "45000000.00"],
      ]);
      expect(await prisma.auditLog.count({ where: { entityId: asset.id, action: "clinic_asset.added" } })).toBe(1);
    });

    test("a rejected gift in kind is never booked", async () => {
      const clinic = await establishedClinic();
      const asset = await land(clinic.id);
      const action = await service.propose({ permissionKey: "clinic_waqf.asset_add", payload: { assetId: asset.id }, makerUserId });
      await service.decide({ governedActionId: action.id, checkerUserId: boardCheckerUserId, approve: false });
      expect((await prisma.programmeAsset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("rejected");
      expect(await lines(asset.id, "asset_added")).toEqual([]);
    });

    test("not before the clinic is established", async () => {
      const draft = await clinics.create({ name: "Draft Asset Clinic", slug: `asset-draft-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" }, makerUserId);
      const asset = await land(draft.id);
      await expect(service.propose({ permissionKey: "clinic_waqf.asset_add", payload: { assetId: asset.id }, makerUserId })).rejects.toThrow(/isn't established/);
    });

    test("disposing of an asset takes it off the register; proceeds stay in the endowment, the loss comes off its capital", async () => {
      const clinic = await establishedClinic();
      const asset = await assets.record(
        clinic.id,
        { kind: "equipment", name: "Ultrasound machine", value: "8000000", valuationNote: "Supplier's valuation on delivery.", donorName: "A supporter", acquiredOn: "2026-10-01", serialNumber: "US-12345" },
        makerUserId,
      );
      const add = await service.propose({ permissionKey: "clinic_waqf.asset_add", payload: { assetId: asset.id }, makerUserId });
      await service.decide({ governedActionId: add.id, checkerUserId: boardCheckerUserId, approve: true });

      await expect(
        service.propose({ permissionKey: "clinic_waqf.asset_dispose", payload: { assetId: asset.id, disposedOn: "2026-11-10", proceeds: "abc", note: "Sold." }, makerUserId }),
      ).rejects.toThrow(BadRequestException);
      const payload = { assetId: asset.id, disposedOn: "2026-11-10", proceeds: "3000000", note: "Beyond repair; sold to a registered dealer for parts." };
      const dispose = await service.propose({ permissionKey: "clinic_waqf.asset_dispose", payload, makerUserId });
      await service.decide({ governedActionId: dispose.id, checkerUserId: boardCheckerUserId, approve: true });

      expect(await prisma.programmeAsset.findUniqueOrThrow({ where: { id: asset.id } })).toMatchObject({ status: "disposed", disposalActionId: dispose.id });
      expect(await lines(asset.id, "asset_disposed")).toEqual([
        ["1000", "3000000.00", "0.00"],
        ["1500", "0.00", "8000000.00"],
        ["3000", "5000000.00", "0.00"],
      ]);
    });

    test("the database refuses changing an asset's value, deleting it, or its maker approving it", async () => {
      const clinic = await establishedClinic();
      const asset = await land(clinic.id);
      await expect(prisma.programmeAsset.update({ where: { id: asset.id }, data: { value: 1 } })).rejects.toThrow(/never change/);
      await expect(prisma.programmeAsset.delete({ where: { id: asset.id } })).rejects.toThrow(/never deleted/);
      await expect(prisma.programmeAsset.update({ where: { id: asset.id }, data: { status: "disposed" } })).rejects.toThrow();
      const action = await service.propose({ permissionKey: "clinic_waqf.asset_add", payload: { assetId: asset.id }, makerUserId });
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } })).rejects.toThrow();
    });

    test("care details can be kept up to date, and are audited", async () => {
      const clinic = await establishedClinic();
      const asset = await land(clinic.id);
      const updated = await assets.updateCare(clinic.id, asset.id, { location: "Bodija, Ibadan", nextServiceDue: "2027-06-01" }, makerUserId);
      expect(updated.location).toBe("Bodija, Ibadan");
      expect(await prisma.auditLog.count({ where: { entityId: asset.id, action: "clinic_asset.care_updated" } })).toBe(1);
    });
  });

  // clinic_waqf.works_approve / spend_approve / spend_mark_paid (slice 5b).
  // Maker mutawalli_officer (makerUserId); the Board (boardCheckerUserId)
  // approves; Compliance (distributionCheckerUserId) confirms payment.
  // Spending rows and the ledger are never deleted: fixtures stay behind.
  describe("clinic waqf spending", () => {
    const clinics = new ClinicWaqfsService();
    const ledger = new ClinicLedgerService();
    const spending = new ClinicSpendingService(ledger);

    async function clinicWithCash(cash: string) {
      const clinic = await clinics.create(
        { name: "Spending Test Clinic", slug: `spend-clinic-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" },
        makerUserId,
      );
      const deed = await clinics.draftDeed(clinic.id, {}, makerUserId);
      const d = await service.propose({ permissionKey: "clinic_waqf.deed_approve", payload: { deedId: deed.id, textHash: deed.textHash }, makerUserId });
      await service.decide({ governedActionId: d.id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      const e = await service.propose({ permissionKey: "clinic_waqf.establish", payload: { programmeId: clinic.id }, makerUserId });
      await service.decide({ governedActionId: e.id, checkerUserId: boardCheckerUserId, approve: true });
      await prisma.$transaction((tx) =>
        ledger.post(tx, {
          programmeId: clinic.id,
          description: "Test endowed gifts",
          currency: "NGN",
          source: "manual_adjustment",
          actorType: "system",
          lines: [
            { accountCode: "1000", debit: cash },
            { accountCode: "3000", credit: cash },
          ],
        }),
      );
      return clinic;
    }

    const partner = (name: string) =>
      prisma.counterparty.create({ data: { name: `${name} ${randomUUID()}`, institutionType: "business", jurisdiction: "NG", status: "active", businessActivities: "Supplies and builds for clinics." } });

    const paid = (spendId: string, paidOn = "2026-11-17") => ({ spendId, bankReference: "ZENITH/TRF/0001", paidOn });

    test("the Board approves works; the Board or Compliance approves a payment; Compliance or Audit confirms it", async () => {
      const checkers = async (key: string) =>
        (await prisma.rolePermission.findMany({ where: { permission: { key }, canChecker: true }, select: { role: { select: { key: true } } } })).map((g) => g.role.key).sort();
      expect(await checkers("clinic_waqf.works_approve")).toEqual(["board_of_trustees"]);
      expect(await checkers("clinic_waqf.spend_approve")).toEqual(["board_of_trustees", "compliance_officer"]);
      expect(await checkers("clinic_waqf.spend_mark_paid")).toEqual(["audit_committee", "compliance_officer"]);
    });

    test("buying equipment: approved, paid by bank transfer, then confirmed — which books it and adds the asset at cost", async () => {
      const clinic = await clinicWithCash("10000000");
      const supplier = await partner("Fixture Medical Supplies");
      const spend = await spending.createSpend(
        clinic.id,
        { kind: "equipment", payeeId: supplier.id, description: "Haematology analyser", amount: "4000000", supportingReference: "INV-2026-0042" },
        makerUserId,
      );
      expect(await prisma.auditLog.count({ where: { entityId: spend.id, action: "clinic_spend.created" } })).toBe(1);

      await expect(service.propose({ permissionKey: "clinic_waqf.spend_mark_paid", payload: paid(spend.id), makerUserId })).rejects.toThrow(/Only an approved payment/);
      const approve = await service.propose({ permissionKey: "clinic_waqf.spend_approve", payload: { spendId: spend.id }, makerUserId });
      await service.decide({ governedActionId: approve.id, checkerUserId: boardCheckerUserId, approve: true });
      await expect(
        service.propose({ permissionKey: "clinic_waqf.spend_mark_paid", payload: paid(spend.id, "2999-01-01"), makerUserId }),
      ).rejects.toThrow(/future/);
      const markPaid = await service.propose({ permissionKey: "clinic_waqf.spend_mark_paid", payload: paid(spend.id), makerUserId });
      await service.decide({ governedActionId: markPaid.id, checkerUserId: distributionCheckerUserId, approve: true });

      const done = await prisma.programmeSpend.findUniqueOrThrow({ where: { id: spend.id }, include: { asset: true } });
      expect(done).toMatchObject({ status: "paid", bankReference: "ZENITH/TRF/0001", paymentActionId: markPaid.id });
      expect(done.asset).toMatchObject({ acquisition: "purchased", status: "active", kind: "equipment" });
      expect(done.asset!.value.toFixed(2)).toBe("4000000.00");
      const lines = (await prisma.programmeJournalEntry.findMany({ where: { source: "spend_paid", sourceId: spend.id }, include: { lines: { include: { ledgerAccount: true } } } }))
        .flatMap((e) => e.lines)
        .map((l) => [l.ledgerAccount.code, l.debit.toFixed(2), l.credit.toFixed(2)])
        .sort();
      expect(lines).toEqual([
        ["1000", "0.00", "4000000.00"],
        ["1500", "4000000.00", "0.00"],
      ]);
    });

    test("never more than the endowment's free cash: what's proposed or approved counts as committed", async () => {
      const clinic = await clinicWithCash("5000000");
      const supplier = await partner("Fixture Supplier");
      await spending.createSpend(clinic.id, { kind: "equipment", payeeId: supplier.id, description: "Ultrasound", amount: "3000000", supportingReference: "INV-1" }, makerUserId);
      await expect(
        spending.createSpend(clinic.id, { kind: "equipment", payeeId: supplier.id, description: "Fridges", amount: "2500000", supportingReference: "INV-2" }, makerUserId),
      ).rejects.toThrow(/free to commit/);
    });

    test("works stages: only once the Board approves the project, only to its contractor, never past budget", async () => {
      const clinic = await clinicWithCash("50000000");
      const contractor = await partner("Fixture Builders");
      const other = await partner("Fixture Other Builder");
      const project = await spending.proposeWorks(
        clinic.id,
        { name: "Clinic building, phase 1", route: "build_on_donated_land", contractorId: contractor.id, budget: "5000000", budgetNote: "Quantity surveyor's bill of quantities BQ-7; cheaper than renovating." },
        makerUserId,
      );
      const stage = (amount: string, payeeId = contractor.id) =>
        spending.createSpend(clinic.id, { kind: "works_stage", worksProjectId: project.id, payeeId, description: "Foundations", amount, supportingReference: "ENG-CERT-1" }, makerUserId);
      await expect(stage("1000000")).rejects.toThrow(/hasn't approved/);

      const approve = await service.propose({ permissionKey: "clinic_waqf.works_approve", payload: { worksProjectId: project.id }, makerUserId });
      await service.decide({ governedActionId: approve.id, checkerUserId: boardCheckerUserId, approve: true });
      expect((await prisma.programmeWorksProject.findUniqueOrThrow({ where: { id: project.id } })).status).toBe("approved");

      await expect(stage("1000000", other.id)).rejects.toThrow(/own contractor/);
      await stage("3000000");
      await expect(stage("2500000")).rejects.toThrow(/past its budget/);
      await expect(stage("2000000")).resolves.toMatchObject({ status: "pending_approval" });
    });

    test("the database refuses changing a payment, deleting it, or its maker approving it", async () => {
      const clinic = await clinicWithCash("1000000");
      const supplier = await partner("Fixture DB Supplier");
      const spend = await spending.createSpend(clinic.id, { kind: "equipment", payeeId: supplier.id, description: "Microscope", amount: "500000", supportingReference: "INV-9" }, makerUserId);
      await expect(prisma.programmeSpend.update({ where: { id: spend.id }, data: { amount: 1 } })).rejects.toThrow(/never change/);
      await expect(prisma.programmeSpend.delete({ where: { id: spend.id } })).rejects.toThrow(/never deleted/);
      await expect(prisma.programmeSpend.update({ where: { id: spend.id }, data: { status: "paid" } })).rejects.toThrow();
      const action = await service.propose({ permissionKey: "clinic_waqf.spend_approve", payload: { spendId: spend.id }, makerUserId });
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } })).rejects.toThrow();
    });
  });

  // Clinic waqf investments (slice 5c). The Investment Committee
  // (investmentMakerUserId) records and places; a Shariah board member
  // (beneficiaryCheckerUserId) screens; the Board approves the placement
  // payment; Compliance (distributionCheckerUserId) confirms it.
  describe("clinic waqf investments", () => {
    const clinics = new ClinicWaqfsService();
    const ledger = new ClinicLedgerService();
    const spending = new ClinicSpendingService(ledger);
    const investments = new ClinicInvestmentsService(ledger, spending, new ClinicReserveService(ledger));

    async function clinicWithCash(cash: string) {
      const clinic = await clinics.create({ name: "Investment Test Clinic", slug: `invest-clinic-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" }, makerUserId);
      const deed = await clinics.draftDeed(clinic.id, {}, makerUserId);
      const d = await service.propose({ permissionKey: "clinic_waqf.deed_approve", payload: { deedId: deed.id, textHash: deed.textHash }, makerUserId });
      await service.decide({ governedActionId: d.id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      const e = await service.propose({ permissionKey: "clinic_waqf.establish", payload: { programmeId: clinic.id }, makerUserId });
      await service.decide({ governedActionId: e.id, checkerUserId: boardCheckerUserId, approve: true });
      await prisma.$transaction((tx) =>
        ledger.post(tx, {
          programmeId: clinic.id,
          description: "Test endowed gifts",
          currency: "NGN",
          source: "manual_adjustment",
          actorType: "system",
          lines: [
            { accountCode: "1000", debit: cash },
            { accountCode: "3000", credit: cash },
          ],
        }),
      );
      return clinic;
    }

    const balances = async (programmeId: string) => {
      const b = await ledger.balances(programmeId);
      return Object.fromEntries([...b.endowment, ...b.running].map((r) => [r.code, r.balance]));
    };

    test("recorded, screened by someone else, placed through an approved and confirmed payment; income goes to the running fund; the principal comes back", async () => {
      const clinic = await clinicWithCash("20000000");
      const bank = await prisma.counterparty.create({ data: { name: `Fixture Islamic Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "NG", status: "active", businessActivities: "Non-interest banking." } });
      const investment = await investments.create(
        clinic.id,
        { counterpartyId: bank.id, name: "12-month mudarabah deposit", instrumentType: "other", amount: "15000000", businessDescription: "A profit-sharing deposit with a non-interest bank." },
        investmentMakerUserId,
      );
      await expect(investments.screen(clinic.id, investment.id, { decision: "approved", note: "Fine." }, investmentMakerUserId)).rejects.toThrow(ForbiddenException);
      await expect(investments.proposePlacement(clinic.id, investment.id, { agreementReference: "MUD-2026-01" }, investmentMakerUserId)).rejects.toThrow(/not ready to place/);
      await investments.screen(clinic.id, investment.id, { decision: "approved", note: "A permissible profit-sharing deposit." }, beneficiaryCheckerUserId);

      const placement = await investments.proposePlacement(clinic.id, investment.id, { agreementReference: "MUD-2026-01" }, investmentMakerUserId);
      expect(placement).toMatchObject({ kind: "investment", investmentId: investment.id, payeeId: bank.id });
      const approve = await service.propose({ permissionKey: "clinic_waqf.spend_approve", payload: { spendId: placement.id }, makerUserId: investmentMakerUserId });
      await service.decide({ governedActionId: approve.id, checkerUserId: boardCheckerUserId, approve: true });
      const markPaid = await service.propose({
        permissionKey: "clinic_waqf.spend_mark_paid",
        payload: { spendId: placement.id, bankReference: "ZENITH/INV/0001", paidOn: "2026-11-17" },
        makerUserId: investmentMakerUserId,
      });
      await service.decide({ governedActionId: markPaid.id, checkerUserId: distributionCheckerUserId, approve: true });

      expect((await prisma.programmeInvestment.findUniqueOrThrow({ where: { id: investment.id } })).status).toBe("placed");
      expect(await balances(clinic.id)).toMatchObject({ "1000": "5000000.00", "1200": "15000000.00" });

      await investments.recordIncome(clinic.id, investment.id, { amount: "600000", receivedOn: "2026-11-17", bankReference: "ZENITH/PRF/0001", description: "First quarter's profit share" }, makerUserId);
      expect(await balances(clinic.id)).toMatchObject({ "1100": "600000.00", "4100": "600000.00", "1000": "5000000.00", "3000": "20000000.00" });

      await investments.recordReturn(clinic.id, investment.id, { returnedOn: "2026-11-17", bankReference: "ZENITH/RET/0001" }, investmentMakerUserId);
      expect(await balances(clinic.id)).toMatchObject({ "1000": "20000000.00", "1200": "0.00" });
      expect((await prisma.programmeInvestment.findUniqueOrThrow({ where: { id: investment.id } })).status).toBe("returned");
    });

    test("the database refuses a self-screening, income from an unplaced investment, or rewriting income", async () => {
      const clinic = await clinicWithCash("1000000");
      const bank = await prisma.counterparty.create({ data: { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "NG", status: "active", businessActivities: "Banking." } });
      const investment = await investments.create(
        clinic.id,
        { counterpartyId: bank.id, name: "Sukuk", instrumentType: "sukuk", amount: "500000", businessDescription: "Government sukuk." },
        investmentMakerUserId,
      );
      await expect(
        prisma.programmeInvestment.update({ where: { id: investment.id }, data: { status: "shariah_approved", shariahDecidedByUserId: investmentMakerUserId, shariahDecidedAt: new Date() } }),
      ).rejects.toThrow(/programme_investments_reviewer_not_creator/);
      await expect(
        prisma.programmeInvestmentIncome.create({ data: { investmentId: investment.id, amount: 100, receivedOn: new Date(), bankReference: "X1", description: "Too early", recordedByUserId: makerUserId } }),
      ).rejects.toThrow(/placed/);
      await expect(prisma.programmeInvestment.delete({ where: { id: investment.id } })).rejects.toThrow(/never deleted/);
    });
  });

  // clinic_waqf.reserve_share_set (slice 9), and reserve replacements
  // through clinic_waqf.spend_approve / spend_mark_paid. Maker
  // mutawalli_officer (makerUserId); the share's checker is the Board only
  // (boardCheckerUserId). Clinic waqfs, assets, spends and ledgers are
  // never deleted, so these fixtures stay behind.
  describe("clinic waqf equipment reserve", () => {
    const clinics = new ClinicWaqfsService();
    const ledger = new ClinicLedgerService();
    const reserve = new ClinicReserveService(ledger);
    const spending = new ClinicSpendingService(ledger);
    const investments = new ClinicInvestmentsService(ledger, spending, reserve);
    const today = lagosToday();

    async function clinicWithCash(cash: string) {
      const clinic = await clinics.create({ name: "Reserve Test Clinic", slug: `reserve-clinic-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" }, makerUserId);
      const deed = await clinics.draftDeed(clinic.id, {}, makerUserId);
      const d = await service.propose({ permissionKey: "clinic_waqf.deed_approve", payload: { deedId: deed.id, textHash: deed.textHash }, makerUserId });
      await service.decide({ governedActionId: d.id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      const e = await service.propose({ permissionKey: "clinic_waqf.establish", payload: { programmeId: clinic.id }, makerUserId });
      await service.decide({ governedActionId: e.id, checkerUserId: boardCheckerUserId, approve: true });
      await prisma.$transaction((tx) =>
        ledger.post(tx, {
          programmeId: clinic.id,
          description: "Test endowed gifts",
          currency: "NGN",
          source: "manual_adjustment",
          actorType: "system",
          lines: [
            { accountCode: "1000", debit: cash },
            { accountCode: "3000", credit: cash },
          ],
        }),
      );
      return clinic;
    }

    const balances = async (programmeId: string) => {
      const b = await ledger.balances(programmeId);
      return Object.fromEntries([...b.endowment, ...b.running].map((r) => [r.code, r.balance]));
    };
    const supplier = () =>
      prisma.counterparty.create({ data: { name: `Fixture Medical Supplier ${randomUUID()}`, institutionType: "business", jurisdiction: "NG", status: "active", businessActivities: "Sells laboratory equipment." } });

    /** Approves (Board) and confirms (Compliance) a payment. */
    async function pay(spendId: string) {
      const a = await service.propose({ permissionKey: "clinic_waqf.spend_approve", payload: { spendId }, makerUserId });
      await service.decide({ governedActionId: a.id, checkerUserId: boardCheckerUserId, approve: true });
      const m = await service.propose({ permissionKey: "clinic_waqf.spend_mark_paid", payload: { spendId, bankReference: "ZENITH/EQP/0001", paidOn: today }, makerUserId });
      await service.decide({ governedActionId: m.id, checkerUserId: distributionCheckerUserId, approve: true });
      return prisma.programmeSpend.findUniqueOrThrow({ where: { id: spendId } });
    }

    async function setShare(programmeId: string, percent: number) {
      const action = await service.propose({ permissionKey: "clinic_waqf.reserve_share_set", payload: { programmeId, percent }, makerUserId });
      await service.decide({ governedActionId: action.id, checkerUserId: boardCheckerUserId, approve: true });
      return action;
    }

    /** A placed investment, so income can be recorded against it. */
    async function placedInvestment(programmeId: string) {
      const bank = await prisma.counterparty.create({ data: { name: `Fixture Islamic Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "NG", status: "active", businessActivities: "Non-interest banking." } });
      const investment = await investments.create(
        programmeId,
        { counterpartyId: bank.id, name: "Sukuk", instrumentType: "sukuk", amount: "1000000", businessDescription: "Government sukuk." },
        investmentMakerUserId,
      );
      await investments.screen(programmeId, investment.id, { decision: "approved", note: "Permissible." }, beneficiaryCheckerUserId);
      const placement = await investments.proposePlacement(programmeId, investment.id, { agreementReference: "SUK-2026-01" }, investmentMakerUserId);
      await pay(placement.id);
      return investment;
    }

    test("only the Board sets the reserve's share", async () => {
      const grants = await prisma.rolePermission.findMany({
        where: { permission: { key: "clinic_waqf.reserve_share_set" } },
        select: { canMaker: true, canChecker: true, role: { select: { key: true } } },
      });
      expect(grants.filter((g) => g.canChecker).map((g) => g.role.key)).toEqual(["board_of_trustees"]);
      expect(grants.filter((g) => g.canMaker).map((g) => g.role.key)).toEqual(["mutawalli_officer"]);
    });

    test("the Board's share of each income receipt is set aside at once, rounded down", async () => {
      const clinic = await clinicWithCash("2000000");
      const investment = await placedInvestment(clinic.id);
      const income = (amount: string) =>
        investments.recordIncome(clinic.id, investment.id, { amount, receivedOn: today, bankReference: "ZENITH/PRF/0001", description: "Profit share" }, makerUserId);

      await income("100000");
      expect(await balances(clinic.id)).toMatchObject({ "1100": "100000.00", "1150": "0.00" });

      await expect(service.propose({ permissionKey: "clinic_waqf.reserve_share_set", payload: { programmeId: clinic.id, percent: 101 }, makerUserId })).rejects.toThrow(/0 to 100/);
      const action = await service.propose({ permissionKey: "clinic_waqf.reserve_share_set", payload: { programmeId: clinic.id, percent: 15 }, makerUserId });
      await expect(service.propose({ permissionKey: "clinic_waqf.reserve_share_set", payload: { programmeId: clinic.id, percent: 20 }, makerUserId })).rejects.toThrow(ConflictException);
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } })).rejects.toThrow();
      await service.decide({ governedActionId: action.id, checkerUserId: boardCheckerUserId, approve: true });
      expect(await prisma.waqfProgramme.findUniqueOrThrow({ where: { id: clinic.id } })).toMatchObject({ reserveSharePercent: 15, reserveShareActionId: action.id });
      expect(await prisma.auditLog.count({ where: { entityId: clinic.id, action: "clinic_waqf.reserve_share_set" } })).toBe(1);

      // 15% of ₦33,333.33 is ₦4,999.9995: ₦4,999.99 is set aside.
      await income("33333.33");
      expect(await balances(clinic.id)).toMatchObject({ "1150": "4999.99", "1100": "128333.34", "4100": "133333.33" });
    });

    test("the reserve replaces registered equipment only, within what it holds; the old item is retired and the new one joins the endowment", async () => {
      const clinic = await clinicWithCash("3000000");
      const seller = await supplier();
      const bought = await spending.createSpend(
        clinic.id,
        { kind: "equipment", payeeId: seller.id, description: "Haematology analyser", amount: "1200000", supportingReference: "INV-2026-001" },
        makerUserId,
      );
      const oldAsset = (await prisma.programmeAsset.findUniqueOrThrow({ where: { id: (await pay(bought.id)).assetId! } }));

      await expect(
        spending.createSpend(clinic.id, { kind: "reserve_replacement", payeeId: seller.id, description: "New analyser", amount: "100", supportingReference: "INV-2026-002" }, makerUserId),
      ).rejects.toThrow(/names the equipment it replaces/);
      const replace = (amount: string) =>
        spending.createSpend(
          clinic.id,
          { kind: "reserve_replacement", replacesAssetId: oldAsset.id, payeeId: seller.id, description: "Haematology analyser, newer model", amount, supportingReference: "INV-2026-002" },
          makerUserId,
        );
      // The reserve is empty: endowment cash doesn't pay for a replacement.
      await expect(replace("1500000")).rejects.toThrow(/of the equipment replacement reserve is free/);

      const investment = await placedInvestment(clinic.id);
      await setShare(clinic.id, 50);
      await investments.recordIncome(clinic.id, investment.id, { amount: "3000000", receivedOn: today, bankReference: "ZENITH/PRF/0002", description: "Profit share" }, makerUserId);
      expect((await balances(clinic.id))["1150"]).toBe("1500000.00");
      await expect(replace("1500000.01")).rejects.toThrow(/free to commit/);

      const spend = await replace("1500000");
      await expect(replace("1")).rejects.toThrow(/already has a replacement/);
      await pay(spend.id);

      const retired = await prisma.programmeAsset.findUniqueOrThrow({ where: { id: oldAsset.id } });
      expect(retired).toMatchObject({ status: "disposed", disposedOn: new Date(`${today}T00:00:00Z`) });
      const paid = await prisma.programmeSpend.findUniqueOrThrow({ where: { id: spend.id }, include: { asset: true } });
      expect(paid.asset).toMatchObject({ status: "active", kind: "equipment", acquisition: "purchased" });
      expect(paid.asset!.value.toFixed(2)).toBe("1500000.00");
      // Endowment cash is untouched by the replacement; premises and equipment
      // hold the new analyser (₦1.5m) in place of the old (₦1.2m), plus the
      // investment's ₦1m is in 1200, not 1500.
      expect(await balances(clinic.id)).toMatchObject({
        "1150": "0.00",
        "5200": "1500000.00",
        "1500": "1500000.00",
        "3100": "1500000.00",
        "3000": "1800000.00",
        "1000": "800000.00",
      });
      await expect(
        spending.createSpend(clinic.id, { kind: "reserve_replacement", replacesAssetId: oldAsset.id, payeeId: seller.id, description: "Again", amount: "1", supportingReference: "INV-2026-003" }, makerUserId),
      ).rejects.toThrow(/on the register now/);
    });

    test("the database refuses a share without the Board's approval, and a replacement that names no asset", async () => {
      const clinic = await clinicWithCash("100");
      await expect(prisma.waqfProgramme.update({ where: { id: clinic.id }, data: { reserveSharePercent: 10 } })).rejects.toThrow(/reserve_share_approved/);
      const seller = await supplier();
      await expect(
        prisma.programmeSpend.create({
          data: { programmeId: clinic.id, kind: "reserve_replacement", payeeId: seller.id, description: "No asset", amount: 10, supportingReference: "INV-1", createdByUserId: makerUserId },
        }),
      ).rejects.toThrow(/kind_target/);
    });
  });

  // clinic_waqf.price_list_approve (slice 6). Maker mutawalli_officer
  // (makerUserId); checkers the Board (boardCheckerUserId) or Compliance
  // (distributionCheckerUserId). Price lists are never deleted, so these
  // fixtures stay behind.
  describe("clinic waqf price lists", () => {
    const clinics = new ClinicWaqfsService();
    const lists = new ClinicPriceListsService();
    const newClinic = () =>
      clinics.create({ name: "Price List Test Clinic", slug: `ga-prices-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" }, makerUserId);
    const input = (antenatal = "3500") => ({
      services: [
        { code: "anc-visit", name: "Antenatal visit", price: antenatal },
        { code: "FBC", name: "Full blood count", price: "2500.5" },
      ],
      bands: [
        { code: "B", name: "Low income", whoQualifies: "Household income under ₦100,000 a month", patientSharePercent: 30 },
        { code: "A", name: "Poorest", whoQualifies: "Household income under ₦50,000 a month", patientSharePercent: 0 },
      ],
      monthlySubsidyCap: "2000000",
    });
    const propose = (list: { id: string; contentHash: string }) =>
      service.propose({ permissionKey: "clinic_waqf.price_list_approve", payload: { priceListId: list.id, contentHash: list.contentHash }, makerUserId });

    test("only the Board or Compliance may approve a price list", async () => {
      const grants = await prisma.rolePermission.findMany({
        where: { permission: { key: "clinic_waqf.price_list_approve" } },
        select: { canMaker: true, canChecker: true, role: { select: { key: true } } },
      });
      expect(grants.filter((g) => g.canChecker).map((g) => g.role.key).sort()).toEqual(["board_of_trustees", "compliance_officer"]);
      expect(grants.filter((g) => g.canMaker).map((g) => g.role.key)).toEqual(["mutawalli_officer"]);
    });

    test("the stored list is canonical, so the same list always has the same hash", () => {
      const a = canonicalPriceList(input());
      const b = canonicalPriceList({ ...input(), services: [...input().services].reverse() });
      expect(a.text).toBe(b.text);
      expect(a.content.services.map((s) => s.code)).toEqual(["ANC-VISIT", "FBC"]);
      expect(a.content.services[1].price).toBe("2500.50");
      expect(() => canonicalPriceList({ ...input(), bands: [...input().bands, { ...input().bands[0], code: "b" }] })).toThrow(/used twice/);
      expect(() => canonicalPriceList(input("12.345"))).toThrow(/naira and kobo/);
      expect(() => canonicalPriceList({ ...input(), services: [{ code: "X Y", name: "Bad", price: "1" }] })).toThrow(/capital letters/);
    });

    test("approving makes a version live and supersedes the last; one draft at a time", async () => {
      const clinic = await newClinic();
      expect(await lists.current(prisma, clinic.id)).toBeNull();
      const v1 = await lists.draft(clinic.id, input(), makerUserId);
      await expect(lists.draft(clinic.id, input(), makerUserId)).rejects.toThrow(ConflictException);
      expect(await prisma.auditLog.count({ where: { entityId: v1.id, action: "clinic_price_list.drafted" } })).toBe(1);

      const action = await propose(v1);
      await expect(propose(v1)).rejects.toThrow(ConflictException);
      await expect(lists.discard(clinic.id, v1.id, makerUserId)).rejects.toThrow(/waiting for approval/);
      await service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: true });
      expect(await prisma.clinicPriceList.findUniqueOrThrow({ where: { id: v1.id } })).toMatchObject({ status: "approved", approvedActionId: action.id });
      const logs = await prisma.auditLog.findMany({ where: { entityId: v1.id, action: "clinic_price_list.approved" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].actorUserId).toBe(distributionCheckerUserId);
      expect((await lists.current(prisma, clinic.id))?.version).toBe(1);

      const v2 = await lists.draft(clinic.id, input("4000"), makerUserId);
      expect(v2.version).toBe(2);
      await service.decide({ governedActionId: (await propose(v2)).id, checkerUserId: boardCheckerUserId, approve: true });
      expect((await prisma.clinicPriceList.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe("superseded");
      const live = await lists.current(prisma, clinic.id);
      expect(live?.version).toBe(2);
      expect(live?.content.services.find((s) => s.code === "ANC-VISIT")?.price).toBe("4000.00");

      const v3 = await lists.draft(clinic.id, input("4500"), makerUserId);
      await lists.discard(clinic.id, v3.id, makerUserId);
      expect((await prisma.clinicPriceList.findUniqueOrThrow({ where: { id: v3.id } })).status).toBe("discarded");
      await expect(propose(v3)).rejects.toThrow(/discarded, not a draft/);
    });

    test("a proposal must name the hash of the list as drafted", async () => {
      const clinic = await newClinic();
      const v1 = await lists.draft(clinic.id, input(), makerUserId);
      await expect(propose({ id: v1.id, contentHash: "0".repeat(64) })).rejects.toThrow(/changed since it was shown/);
    });

    test("the database refuses edited content, a wrong hash, deletion, and the maker as checker", async () => {
      const clinic = await newClinic();
      const v1 = await lists.draft(clinic.id, input(), makerUserId);
      await expect(prisma.clinicPriceList.update({ where: { id: v1.id }, data: { content: "{}", contentHash: priceListHash("{}") } })).rejects.toThrow();
      await expect(
        prisma.clinicPriceList.create({ data: { programmeId: clinic.id, version: 99, content: "{}", contentHash: "0".repeat(64), createdByUserId: makerUserId } }),
      ).rejects.toThrow();
      await expect(prisma.clinicPriceList.delete({ where: { id: v1.id } })).rejects.toThrow();
      await expect(prisma.clinicPriceList.update({ where: { id: v1.id }, data: { status: "approved" } })).rejects.toThrow();
      const action = await propose(v1);
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } })).rejects.toThrow();
    });
  });

  // clinic_waqf.operator_assign / claim_approve / claim_mark_paid (slice 7).
  // Maker mutawalli_officer (makerUserId). The operator's checker is the
  // Board (boardCheckerUserId); a claim's, the Board or Compliance
  // (distributionCheckerUserId); its payment's, Compliance or the Audit
  // Committee. Claims, lines and the ledger are never deleted, so these
  // fixtures stay behind; the one zakah distribution is rejected afterwards
  // so it commits nothing.
  describe("clinic waqf claims", () => {
    const clinics = new ClinicWaqfsService();
    const ledger = new ClinicLedgerService();
    const lists = new ClinicPriceListsService();
    const claims = new ClinicClaimsService(ledger, lists);
    const licenses = new CounterpartyLicensesService();
    const month = lagosToday().slice(0, 7);
    const day = (d: string) => `${month}-${d}`;

    async function provider() {
      const operator = await prisma.counterparty.create({
        data: { name: `Claims Test Operator ${randomUUID()}`, institutionType: "healthcare_provider", jurisdiction: "NG", status: "active" },
      });
      const nextYear = `${Number(lagosToday().slice(0, 4)) + 1}${lagosToday().slice(4)}`;
      for (const kind of REQUIRED_COUNTERPARTY_LICENSES.healthcare_provider!) {
        const license = await licenses.record(operator.id, { kind, licenseNumber: `CL-${kind.length}7`, issuingAuthority: "Fixture Authority", expiresOn: nextYear }, makerUserId);
        await licenses.verify(license.id, { note: "Saw the certificate." }, distributionCheckerUserId);
      }
      return operator;
    }

    /** An established clinic with running cash, an approved price list and (optionally) an operator. */
    async function readyClinic(runningCash = "100000", withOperator = true) {
      const clinic = await clinics.create({ name: "Claims Test Clinic", slug: `claims-${randomUUID().slice(0, 8)}`, city: "Ibadan", jurisdiction: "NG" }, makerUserId);
      const deed = await clinics.draftDeed(clinic.id, {}, makerUserId);
      const d = await service.propose({ permissionKey: "clinic_waqf.deed_approve", payload: { deedId: deed.id, textHash: deed.textHash }, makerUserId });
      await service.decide({ governedActionId: d.id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      const e = await service.propose({ permissionKey: "clinic_waqf.establish", payload: { programmeId: clinic.id }, makerUserId });
      await service.decide({ governedActionId: e.id, checkerUserId: boardCheckerUserId, approve: true });
      await prisma.$transaction((tx) =>
        ledger.post(tx, {
          programmeId: clinic.id,
          description: "Test running gifts",
          currency: "NGN",
          source: "manual_adjustment",
          actorType: "system",
          lines: [
            { accountCode: "1100", debit: runningCash },
            { accountCode: "4000", credit: runningCash },
          ],
        }),
      );
      const list = await lists.draft(
        clinic.id,
        {
          services: [
            { code: "ANC", name: "Antenatal tests", price: "18500" },
            { code: "FBC", name: "Full blood count", price: "2500" },
          ],
          bands: [
            { code: "A", name: "Poorest", whoQualifies: "Household income under ₦50,000 a month", patientSharePercent: 0 },
            { code: "B", name: "Low income", whoQualifies: "Household income under ₦100,000 a month", patientSharePercent: 20 },
          ],
          monthlySubsidyCap: "50000",
        },
        makerUserId,
      );
      const l = await service.propose({ permissionKey: "clinic_waqf.price_list_approve", payload: { priceListId: list.id, contentHash: list.contentHash }, makerUserId });
      await service.decide({ governedActionId: l.id, checkerUserId: boardCheckerUserId, approve: true });
      const operator = await provider();
      if (withOperator) {
        const a = await service.propose({ permissionKey: "clinic_waqf.operator_assign", payload: { programmeId: clinic.id, counterpartyId: operator.id }, makerUserId });
        await service.decide({ governedActionId: a.id, checkerUserId: boardCheckerUserId, approve: true });
      }
      return { clinic, operator };
    }

    const line = (visitReference: string, serviceCode: string, bandCode: string, patientPaid: string, zakahEligible = false, visitDate = day("01")) => ({
      visitReference,
      visitDate,
      serviceCode,
      bandCode,
      patientPaid,
      zakahEligible,
    });

    test("the Board assigns the operator; the Board or Compliance approves a claim; Compliance or Audit confirms it paid", async () => {
      const checkers = async (key: string) =>
        (await prisma.rolePermission.findMany({ where: { permission: { key }, canChecker: true }, select: { role: { select: { key: true } } } })).map((g) => g.role.key).sort();
      expect(await checkers("clinic_waqf.operator_assign")).toEqual(["board_of_trustees"]);
      expect(await checkers("clinic_waqf.claim_approve")).toEqual(["board_of_trustees", "compliance_officer"]);
      expect(await checkers("clinic_waqf.claim_mark_paid")).toEqual(["audit_committee", "compliance_officer"]);
    });

    test("only a licensed, active healthcare provider can be assigned; the assignment is audited", async () => {
      const { clinic, operator } = await readyClinic("1", false);
      const business = await prisma.counterparty.create({
        data: { name: `Not A Clinic ${randomUUID()}`, institutionType: "business", jurisdiction: "NG", status: "active", businessActivities: "Sells things." },
      });
      await expect(
        service.propose({ permissionKey: "clinic_waqf.operator_assign", payload: { programmeId: clinic.id, counterpartyId: business.id }, makerUserId }),
      ).rejects.toThrow(/isn't a healthcare provider/);
      const unlicensed = await prisma.counterparty.create({
        data: { name: `Unlicensed Clinic ${randomUUID()}`, institutionType: "healthcare_provider", jurisdiction: "NG", status: "active" },
      });
      await expect(
        service.propose({ permissionKey: "clinic_waqf.operator_assign", payload: { programmeId: clinic.id, counterpartyId: unlicensed.id }, makerUserId }),
      ).rejects.toThrow(/licences are in order/);
      await expect(claims.createClaim(clinic.id, { period: month, lines: [line("V1", "FBC", "A", "0")] }, makerUserId)).rejects.toThrow(/No operator/);

      const action = await service.propose({ permissionKey: "clinic_waqf.operator_assign", payload: { programmeId: clinic.id, counterpartyId: operator.id }, makerUserId });
      await expect(
        service.propose({ permissionKey: "clinic_waqf.operator_assign", payload: { programmeId: clinic.id, counterpartyId: operator.id }, makerUserId }),
      ).rejects.toThrow(ConflictException);
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } })).rejects.toThrow();
      await service.decide({ governedActionId: action.id, checkerUserId: boardCheckerUserId, approve: true });
      expect(await prisma.waqfProgramme.findUniqueOrThrow({ where: { id: clinic.id } })).toMatchObject({ operatorId: operator.id, operatorActionId: action.id });
      expect(await prisma.auditLog.count({ where: { entityId: clinic.id, action: "clinic_waqf.operator_assigned" } })).toBe(1);
      await expect(prisma.waqfProgramme.update({ where: { id: clinic.id }, data: { operatorActionId: null } })).rejects.toThrow(/operator_consistent/);
    });

    test("every line is checked against the approved price list, its band's share, the month and earlier claims", async () => {
      const { clinic } = await readyClinic();
      const refused = (lines: ReturnType<typeof line>[]) => claims.createClaim(clinic.id, { period: month, lines }, makerUserId);
      await expect(refused([line("V1", "XRAY", "A", "0")])).rejects.toThrow(/XRAY isn't on price list version 1/);
      await expect(refused([line("V1", "FBC", "Z", "0")])).rejects.toThrow(/band Z isn't on/);
      // Band B pays 20% of ₦2,500: exactly ₦500, never more or less.
      await expect(refused([line("V1", "FBC", "B", "400")])).rejects.toThrow(/which is ₦500.00, not ₦400.00/);
      await expect(refused([line("V1", "FBC", "B", "600")])).rejects.toThrow(/not ₦600.00/);
      await expect(refused([line("V1", "FBC", "A", "0"), line("V1", "FBC", "A", "0")])).rejects.toThrow(/claims FBC twice/);
      await expect(refused([line("V1", "FBC", "A", "0", false, "2020-01-05")])).rejects.toThrow(/isn't in/);
      await expect(claims.createClaim(clinic.id, { period: "2999-01", lines: [line("V1", "FBC", "A", "0")] }, makerUserId)).rejects.toThrow(/hasn't started/);
      // ₦18,500 × 3 from the running fund is over the ₦50,000 cap; zakah lines don't count toward it.
      await expect(refused([line("V1", "ANC", "A", "0"), line("V2", "ANC", "A", "0"), line("V3", "ANC", "A", "0")])).rejects.toThrow(/over the monthly subsidy cap/);

      const claim = await claims.createClaim(
        clinic.id,
        { period: month, lines: [line("V1", "ANC", "B", "3700"), line("V1", "FBC", "A", "0", true), line("V2", "ANC", "A", "0", true), line("V3", "ANC", "A", "0", true)] },
        makerUserId,
      );
      expect(claim).toMatchObject({ lineCount: 4, status: "submitted" });
      expect(claim.totalPrice.toFixed(2)).toBe("58000.00");
      expect(claim.patientPaid.toFixed(2)).toBe("3700.00");
      expect(claim.runningFundAmount.toFixed(2)).toBe("14800.00");
      expect(claim.zakahAmount.toFixed(2)).toBe("39500.00");
      expect(await prisma.auditLog.count({ where: { entityId: claim.id, action: "clinic_claim.submitted" } })).toBe(1);

      // One live claim a month; a discarded one frees the month, but a visit's service is never claimed twice.
      await expect(refused([line("V9", "FBC", "A", "0")])).rejects.toThrow(/already a submitted claim/);
      await claims.discardClaim(clinic.id, claim.id, makerUserId);
      const again = await refused([line("V1", "FBC", "A", "0", true)]);
      await expect(
        claims.createClaim(clinic.id, { period: `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`, lines: [line("V1", "FBC", "A", "0", true, `${Number(month.slice(0, 4)) - 1}${month.slice(4)}-01`)] }, makerUserId),
      ).rejects.toThrow(/already claimed for/);
      expect(again.status).toBe("submitted");
    });

    test("approve within the running fund's cash, confirm the payment, link the zakah part", async () => {
      const { clinic, operator } = await readyClinic("10000");
      const claim = await claims.createClaim(clinic.id, { period: month, lines: [line("P1", "ANC", "B", "3700"), line("P2", "FBC", "A", "0", true)] }, makerUserId);
      const approve = await service.propose({ permissionKey: "clinic_waqf.claim_approve", payload: { claimId: claim.id }, makerUserId });
      await expect(service.propose({ permissionKey: "clinic_waqf.claim_approve", payload: { claimId: claim.id }, makerUserId })).rejects.toThrow(ConflictException);
      await expect(claims.discardClaim(clinic.id, claim.id, makerUserId)).rejects.toThrow(/waiting for approval/);
      // ₦14,800 from the running fund, which holds ₦10,000.
      await expect(service.decide({ governedActionId: approve.id, checkerUserId: distributionCheckerUserId, approve: true })).rejects.toThrow(/₦10,000.00 free/);

      const { clinic: funded, operator: fundedOperator } = await readyClinic("20000");
      const ok = await claims.createClaim(funded.id, { period: month, lines: [line("P1", "ANC", "B", "3700"), line("P2", "FBC", "A", "0", true)] }, makerUserId);
      const a = await service.propose({ permissionKey: "clinic_waqf.claim_approve", payload: { claimId: ok.id }, makerUserId });
      await service.decide({ governedActionId: a.id, checkerUserId: boardCheckerUserId, approve: true });
      expect(await prisma.clinicClaim.findUniqueOrThrow({ where: { id: ok.id } })).toMatchObject({ status: "approved", approvalActionId: a.id });
      expect(await prisma.auditLog.count({ where: { entityId: ok.id, action: "clinic_claim.approved" } })).toBe(1);

      const paid = { claimId: ok.id, bankReference: "ZENITH/TRF/0042", paidOn: lagosToday() };
      await expect(service.propose({ permissionKey: "clinic_waqf.claim_mark_paid", payload: { ...paid, paidOn: "2999-01-01" }, makerUserId })).rejects.toThrow(/future/);
      const markPaid = await service.propose({ permissionKey: "clinic_waqf.claim_mark_paid", payload: paid, makerUserId });
      await service.decide({ governedActionId: markPaid.id, checkerUserId: distributionCheckerUserId, approve: true });
      expect(await prisma.clinicClaim.findUniqueOrThrow({ where: { id: ok.id } })).toMatchObject({ status: "paid", bankReference: "ZENITH/TRF/0042" });
      const balances = await ledger.balances(funded.id);
      const running = (code: string) => balances.running.find((b: { code: string }) => b.code === code) as { balance: string } | undefined;
      expect(Number(running("1100")?.balance)).toBe(5200);
      expect(Number(running("5000")?.balance)).toBe(14800);

      // The zakah part: a distribution to this claim's operator, poor or needy, for exactly ₦2,500.
      const wrong = await prisma.zakahDistribution.create({
        data: { counterpartyId: operator.id, category: "fuqara", amount: 2500, currency: "NGN", reason: "Clinic claim fixture.", createdByUserId: makerUserId },
      });
      const right = await prisma.zakahDistribution.create({
        data: { counterpartyId: fundedOperator.id, category: "masakin", amount: 2500, currency: "NGN", reason: "Clinic claim fixture.", createdByUserId: makerUserId },
      });
      try {
        await expect(claims.linkZakah(funded.id, ok.id, { zakahDistributionId: wrong.id }, makerUserId)).rejects.toThrow(/this claim's operator/);
        await claims.linkZakah(funded.id, ok.id, { zakahDistributionId: right.id }, makerUserId);
        await expect(claims.linkZakah(funded.id, ok.id, { zakahDistributionId: right.id }, makerUserId)).rejects.toThrow(/already linked/);
        expect(await prisma.auditLog.count({ where: { entityId: ok.id, action: "clinic_claim.zakah_linked" } })).toBe(1);
        await expect(prisma.clinicClaim.update({ where: { id: ok.id }, data: { zakahDistributionId: null } })).rejects.toThrow(/never changes once linked/);
      } finally {
        await prisma.zakahDistribution.updateMany({ where: { id: { in: [wrong.id, right.id] } }, data: { status: "rejected" } });
      }
    });

    test("the database keeps a claim's totals to its lines, and refuses edits, deletion and the maker as checker", async () => {
      const { clinic, operator } = await readyClinic();
      const claim = await claims.createClaim(clinic.id, { period: month, lines: [line("D1", "FBC", "B", "500")] }, makerUserId);
      const list = await lists.current(prisma, clinic.id);
      await expect(
        prisma.clinicClaimLine.create({
          data: { claimId: claim.id, programmeId: clinic.id, visitReference: "D2", visitDate: new Date(`${day("02")}T00:00:00Z`), serviceCode: "FBC", bandCode: "A", price: 2500, patientPaid: 0, subsidy: 2500, zakahEligible: false },
        }),
      ).rejects.toThrow(/totals don't match/);
      await expect(
        prisma.clinicClaim.create({
          data: { programmeId: clinic.id, period: "2020-01", operatorId: operator.id, priceListId: list!.id, lineCount: 1, totalPrice: 100, patientPaid: 0, subsidyTotal: 100, runningFundAmount: 100, zakahAmount: 0, createdByUserId: makerUserId },
        }),
      ).rejects.toThrow(/totals don't match/);
      const [l] = await claims.claimLines(clinic.id, claim.id);
      await expect(prisma.clinicClaimLine.update({ where: { id: l.id }, data: { patientPaid: 0, subsidy: 2500 } })).rejects.toThrow(/never changed/);
      await expect(prisma.clinicClaimLine.delete({ where: { id: l.id } })).rejects.toThrow(/never changed/);
      await expect(prisma.clinicClaim.update({ where: { id: claim.id }, data: { runningFundAmount: 1 } })).rejects.toThrow();
      await expect(prisma.clinicClaim.update({ where: { id: claim.id }, data: { status: "paid" } })).rejects.toThrow();
      await expect(prisma.clinicClaim.delete({ where: { id: claim.id } })).rejects.toThrow(/never deleted/);
      const action = await service.propose({ permissionKey: "clinic_waqf.claim_approve", payload: { claimId: claim.id }, makerUserId });
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } })).rejects.toThrow();
      await service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: false });
      expect((await prisma.clinicClaim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe("rejected");
    });
  });

  describe("zakah", () => {
    const run = Date.now().toString(36);
    let n = 0;

    afterAll(async () => {
      // Approved test rulesets would otherwise appear in the public
      // calculator's school list (dev database). Superseding is the one
      // change the database allows an approved ruleset.
      await prisma.zakahRuleset.updateMany({ where: { key: { startsWith: `test-${run}-` }, status: "approved" }, data: { status: "superseded" } });
    });

    async function draftRuleset() {
      return zakahService.createDraft(
        { key: `test-${run}-ga-${n++}`, madhhab: "maliki", label: "Maliki", rulings: draftRulesets.maliki.rulings },
        makerUserId,
      );
    }
    const snapshot = (draft: { id: string; label: string; rulings: unknown }) => ({
      rulesetId: draft.id,
      label: draft.label,
      rulings: draft.rulings,
    });

    test("zakah.ruleset_approve: approve → the draft is live, audit-logged against the checker", async () => {
      const draft = await draftRuleset();
      const action = await service.propose({ permissionKey: "zakah.ruleset_approve", payload: snapshot(draft), makerUserId });

      await service.decide({ governedActionId: action.id, checkerUserId: beneficiaryCheckerUserId, approve: true });

      const live = await prisma.zakahRuleset.findUniqueOrThrow({ where: { id: draft.id } });
      expect(live).toMatchObject({ status: "approved", approvedGovernedActionId: action.id });
      const logs = await prisma.auditLog.findMany({ where: { entityId: draft.id, action: "zakah_ruleset.approved" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].actorUserId).toBe(beneficiaryCheckerUserId);
    });

    test("zakah.ruleset_approve: reject → the draft stays a draft and can be edited again", async () => {
      const draft = await draftRuleset();
      const action = await service.propose({ permissionKey: "zakah.ruleset_approve", payload: snapshot(draft), makerUserId });

      await service.decide({ governedActionId: action.id, checkerUserId: beneficiaryCheckerUserId, approve: false });

      expect((await prisma.zakahRuleset.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft");
      await expect(
        zakahService.updateDraft(draft.id, { label: "Maliki (revised)", rulings: draftRulesets.maliki.rulings }, makerUserId),
      ).resolves.toMatchObject({ label: "Maliki (revised)" });
    });

    test("zakah.ruleset_approve: a proposal must match the draft exactly", async () => {
      const draft = await draftRuleset();
      await expect(
        service.propose({
          permissionKey: "zakah.ruleset_approve",
          payload: { ...snapshot(draft), rulings: { ...draftRulesets.maliki.rulings, debts: "none" } },
          makerUserId,
        }),
      ).rejects.toThrow(ConflictException);
    });

    test("zakah.ruleset_approve: a draft can only be proposed once at a time", async () => {
      const draft = await draftRuleset();
      const first = await service.propose({ permissionKey: "zakah.ruleset_approve", payload: snapshot(draft), makerUserId });
      await expect(
        service.propose({ permissionKey: "zakah.ruleset_approve", payload: snapshot(draft), makerUserId }),
      ).rejects.toThrow(ConflictException);
      await service.decide({ governedActionId: first.id, checkerUserId: beneficiaryCheckerUserId, approve: false });
    });

    test("zakah.ruleset_approve: the proposer cannot approve it, and the database itself rejects checker = maker", async () => {
      const draft = await draftRuleset();
      const action = await service.propose({ permissionKey: "zakah.ruleset_approve", payload: snapshot(draft), makerUserId });

      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: makerUserId, approve: true }),
      ).rejects.toThrow(ForbiddenException);
      // Bypasses decide()'s app-layer check: the checker_not_maker constraint.
      await expect(
        prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } }),
      ).rejects.toThrow();

      await service.decide({ governedActionId: action.id, checkerUserId: beneficiaryCheckerUserId, approve: false });
      expect((await prisma.zakahRuleset.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft");
    });

    test("zakah.metal_price_set: approve → a price row linked to the action, audit-logged", async () => {
      const payload = { goldPerGram: "150000", silverPerGram: "2000", asOf: "2001-01-12", source: "Governed fixture" };
      const action = await service.propose({ permissionKey: "zakah.metal_price_set", payload, makerUserId: investmentMakerUserId });
      await expect(
        service.propose({ permissionKey: "zakah.metal_price_set", payload, makerUserId: investmentMakerUserId }),
      ).rejects.toThrow(ConflictException);

      await service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: true });

      const price = await prisma.zakahMetalPrice.findUniqueOrThrow({ where: { governedActionId: action.id } });
      expect(price.goldPerGram.toFixed()).toBe("150000");
      const logs = await prisma.auditLog.findMany({ where: { entityId: price.id, action: "zakah_metal_price.set" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].actorUserId).toBe(distributionCheckerUserId);
    });

    test("zakah.metal_price_set: reject → no price is recorded", async () => {
      const payload = { goldPerGram: "151000", silverPerGram: "2010", asOf: "2001-01-13", source: "Governed fixture" };
      const action = await service.propose({ permissionKey: "zakah.metal_price_set", payload, makerUserId: investmentMakerUserId });

      await service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: false });

      expect(await prisma.zakahMetalPrice.findUnique({ where: { governedActionId: action.id } })).toBeNull();
    });

    // Distribution. Funds itself first (a confirmed payment booked in the
    // ledger), so the zakah it commits never drains what other runs need.
    async function fundedRecipient() {
      await prisma.$transaction(async (tx) => {
        const id = randomUUID();
        await tx.zakahPayment.create({
          data: {
            id, amount: "100000", currency: "NGN", provider: "paystack", providerReference: id, status: "confirmed",
            confirmedAt: new Date(), settlementSubaccount: "ACCT_test_zakah", wakalahConsentVersion: "test",
          },
        });
        const ledger = new ZakahLedgerService();
        const bank = await ledger.getAccountByCode(tx, "1000");
        const held = await ledger.getAccountByCode(tx, "2000");
        await ledger.post(tx, {
          description: "Test fixture zakah payment", currency: "NGN", source: "payment", sourceId: id, actorType: "system",
          lines: [{ ledgerAccountId: bank.id, debit: "100000" }, { ledgerAccountId: held.id, credit: "100000" }],
        });
      });
      const r = await zakahDistributionsService.createRecipient(
        { name: `GA Zakah Recipient ${run}`, categories: ["masakin"], eligibilityReason: "Verified by home visit: no regular income." },
        makerUserId,
      );
      // Two-person registration, through the real engine.
      const approval = await service.propose({ permissionKey: "zakah.recipient_approve", payload: { recipientId: r.id }, makerUserId });
      await service.decide({ governedActionId: approval.id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      return r;
    }

    test("zakah.distribution_approve then zakah.distribution_mark_paid: each needs its own second person, then it's booked", async () => {
      const r = await fundedRecipient();
      const d = await zakahDistributionsService.create(
        { recipientId: r.id, category: "masakin", amount: "15000", reason: "Food and rent support this month." },
        makerUserId,
      );

      const approval = await service.propose({ permissionKey: "zakah.distribution_approve", payload: { distributionId: d.id }, makerUserId });
      await service.decide({ governedActionId: approval.id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      expect(await prisma.zakahDistribution.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({
        status: "approved",
        approvalActionId: approval.id,
      });

      const paid = await service.propose({
        permissionKey: "zakah.distribution_mark_paid",
        payload: { distributionId: d.id, bankReference: `GA-${run}`, paidOn: new Date().toISOString().slice(0, 10) },
        makerUserId,
      });
      await service.decide({ governedActionId: paid.id, checkerUserId: distributionCheckerUserId, approve: true });

      expect(await prisma.zakahDistribution.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "paid", paymentActionId: paid.id });
      expect(await prisma.zakahJournalEntry.count({ where: { source: "distribution", sourceId: d.id } })).toBe(1);
      const logs = await prisma.auditLog.findMany({ where: { entityId: d.id, action: { in: ["zakah_distribution.approved", "zakah_distribution.paid"] } } });
      expect(logs.map((l) => [l.action, l.actorUserId]).sort()).toEqual([
        ["zakah_distribution.approved", beneficiaryCheckerUserId],
        ["zakah_distribution.paid", distributionCheckerUserId],
      ]);
    });

    test("approving a zakah distribution can't deadlock with a transaction holding the spending limit", async () => {
      // Creating a distribution takes the zakah spending-limit lock, then
      // writes its audit row. Approving one used to write its audit row
      // (taking the audit chain's lock) and only then the spending-limit
      // lock, so the two could each wait on the other forever until
      // Postgres cancelled one (seen 2026-11-15). Here another transaction
      // holds the spending limit while the approval starts, then writes
      // its audit row: in the old order that's a deadlock.
      const r = await fundedRecipient();
      const d = await zakahDistributionsService.create(
        { recipientId: r.id, category: "masakin", amount: "1000", reason: "Food support this month." },
        makerUserId,
      );
      const approval = await service.propose({ permissionKey: "zakah.distribution_approve", payload: { distributionId: d.id }, makerUserId });

      let holding!: () => void;
      const lockHeld = new Promise<void>((resolve) => (holding = resolve));
      let letGo!: () => void;
      const released = new Promise<void>((resolve) => (letGo = resolve));
      const other = prisma.$transaction(
        async (tx) => {
          await lockZakahCommitments(tx);
          holding();
          await released;
          await tx.auditLog.create({
            data: { actorType: "birr_staff", actorUserId: makerUserId, action: "test.lock_order", entityType: "ZakahDistribution", entityId: d.id },
          });
        },
        { timeout: 20_000 },
      );
      await lockHeld;
      const decision = service.decide({ governedActionId: approval.id, checkerUserId: distributionCheckerUserId, approve: true });
      // Long enough for the approval to reach the spending-limit lock and wait.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      letGo();

      await expect(Promise.all([other, decision])).resolves.toBeDefined();
      expect((await prisma.zakahDistribution.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("approved");
    }, 30_000);

    test("zakah.recipient_approve and zakah.recipient_change: approved by a second person, audited; the database rejects checker = maker", async () => {
      const r = await zakahDistributionsService.createRecipient(
        { name: `GA Recipient ${run}`, categories: ["fuqara"], eligibilityReason: "Widow with four children; verified by home visit.", bankName: "Test Bank", accountNumber: "0123456789", accountName: "GA Recipient" },
        makerUserId,
      );
      const approval = await service.propose({ permissionKey: "zakah.recipient_approve", payload: { recipientId: r.id }, makerUserId });
      await expect(service.decide({ governedActionId: approval.id, checkerUserId: makerUserId, approve: true })).rejects.toThrow(ForbiddenException);
      await expect(prisma.governedAction.update({ where: { id: approval.id }, data: { checkerUserId: makerUserId } })).rejects.toThrow();
      await service.decide({ governedActionId: approval.id, checkerUserId: distributionCheckerUserId, approve: true });
      expect(await prisma.zakahRecipient.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "approved", approvalActionId: approval.id });
      expect(await prisma.auditLog.count({ where: { entityId: r.id, action: "zakah_recipient.approved", actorUserId: distributionCheckerUserId } })).toBe(1);

      await zakahDistributionsService.updateRecipient(
        r.id,
        { name: r.name, categories: ["fuqara"], eligibilityReason: r.eligibilityReason, bankName: "Other Bank", accountNumber: "5555551234", accountName: "GA Recipient" },
        makerUserId,
      );
      const row = await prisma.zakahRecipient.findUniqueOrThrow({ where: { id: r.id } });
      const change = await service.propose({
        permissionKey: "zakah.recipient_change",
        payload: { recipientId: r.id, requestedAt: row.pendingChangeAt!.toISOString() },
        makerUserId,
      });
      // The approval request carries no bank details — they stay encrypted on the recipient.
      expect(JSON.stringify(change.payload)).not.toContain("5555551234");
      await service.decide({ governedActionId: change.id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      expect(await zakahDistributionsService.bankDetails(r.id, beneficiaryCheckerUserId)).toMatchObject({ accountNumber: "5555551234" });
      expect(await prisma.auditLog.count({ where: { entityId: r.id, action: "zakah_recipient.change_approved" } })).toBe(1);
    });

    test("zakah.distribution_approve: reject → rejected, audit-logged, and its amount is released", async () => {
      const r = await fundedRecipient();
      const d = await zakahDistributionsService.create(
        { recipientId: r.id, category: "masakin", amount: "4000", reason: "Food support this month." },
        makerUserId,
      );
      const action = await service.propose({ permissionKey: "zakah.distribution_approve", payload: { distributionId: d.id }, makerUserId });
      await service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: false });

      expect((await prisma.zakahDistribution.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("rejected");
      expect(await prisma.auditLog.count({ where: { entityId: d.id, action: "zakah_distribution.rejected" } })).toBe(1);
    });

    test("zakah.distribution_approve: the proposer can't approve it, and the database itself rejects checker = maker", async () => {
      const r = await fundedRecipient();
      const d = await zakahDistributionsService.create(
        { recipientId: r.id, category: "masakin", amount: "1000", reason: "Food support this month." },
        makerUserId,
      );
      const action = await service.propose({ permissionKey: "zakah.distribution_approve", payload: { distributionId: d.id }, makerUserId });
      await expect(
        service.propose({ permissionKey: "zakah.distribution_approve", payload: { distributionId: d.id }, makerUserId }),
      ).rejects.toThrow(ConflictException);
      await expect(service.decide({ governedActionId: action.id, checkerUserId: makerUserId, approve: true })).rejects.toThrow(ForbiddenException);
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } })).rejects.toThrow();

      await service.decide({ governedActionId: action.id, checkerUserId: beneficiaryCheckerUserId, approve: false });
    });

    // Refunds. Fixture payment in a per-run currency, so this suite's
    // spending limit is its own (see zakah-refunds.service.spec.ts).
    async function refundRequest(amount: string) {
      const currency = `G${run}`.toUpperCase();
      const id = randomUUID();
      const payer = await prisma.zakahPayer.create({ data: { email: `ga-refund-payer-${id}@example.com` } });
      await prisma.zakahPayment.create({
        data: {
          id, amount, currency, payerId: payer.id, contactEmail: payer.email, provider: "paystack", providerReference: id, status: "confirmed", confirmedAt: new Date(),
          settlementSubaccount: "ACCT_test_zakah", wakalahConsentVersion: "test",
        },
      });
      return zakahRefundsService.create(
        { paymentId: id, amount, reason: "duplicate_payment", details: "Paid the same zakah twice in one minute.", bankName: "Test Bank", accountNumber: "0123456789", accountName: "Test Payer" },
        distributionCheckerUserId,
      );
    }

    test("zakah.refund_approve (Compliance → Board) then zakah.refund_mark_paid: approved, then paid and booked", async () => {
      const refund = await refundRequest("8000");
      const approval = await service.propose({ permissionKey: "zakah.refund_approve", payload: { refundId: refund.id }, makerUserId: distributionCheckerUserId });
      await service.decide({ governedActionId: approval.id, checkerUserId: boardCheckerUserId, approve: true });
      expect(await prisma.zakahRefund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ status: "approved", approvalActionId: approval.id });

      const paid = await service.propose({
        permissionKey: "zakah.refund_mark_paid",
        payload: { refundId: refund.id, bankReference: `GR-${run}`, paidOn: new Date().toISOString().slice(0, 10) },
        makerUserId,
      });
      await service.decide({ governedActionId: paid.id, checkerUserId: assetCheckerUserId, approve: true });

      expect(await prisma.zakahRefund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ status: "paid", paymentActionId: paid.id });
      expect(await prisma.zakahJournalEntry.count({ where: { source: "refund", sourceId: refund.id } })).toBe(1);
      // Each decision emails the payer once it has committed.
      await new Promise((r) => setTimeout(r, 200));
      expect(refundNotices.filter((n) => n.refundId === refund.id).map((n) => n.stage)).toEqual(["approved", "paid"]);
      const logs = await prisma.auditLog.findMany({ where: { entityId: refund.id, action: { in: ["zakah_refund.approved", "zakah_refund.paid"] } } });
      expect(logs.map((l) => [l.action, l.actorUserId]).sort()).toEqual([
        ["zakah_refund.approved", boardCheckerUserId],
        ["zakah_refund.paid", assetCheckerUserId],
      ]);
      // The audit trail never carries the payer's bank details.
      expect(logs.every((l) => !JSON.stringify(l.after).includes("payeeBankDetailsEncrypted"))).toBe(true);
    });

    test("zakah.refund_approve: reject → rejected and audit-logged; the proposer can't approve; the database rejects checker = maker", async () => {
      const refund = await refundRequest("2000");
      const action = await service.propose({ permissionKey: "zakah.refund_approve", payload: { refundId: refund.id }, makerUserId: distributionCheckerUserId });
      await expect(
        service.decide({ governedActionId: action.id, checkerUserId: distributionCheckerUserId, approve: true }),
      ).rejects.toThrow(ForbiddenException);
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: distributionCheckerUserId } })).rejects.toThrow();

      await service.decide({ governedActionId: action.id, checkerUserId: boardCheckerUserId, approve: false });
      expect((await prisma.zakahRefund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("rejected");
      // A rejection isn't emailed: its reason may be sensitive, so Compliance tells the payer.
      await new Promise((r) => setTimeout(r, 200));
      expect(refundNotices.some((n) => n.refundId === refund.id)).toBe(false);
      expect(await prisma.auditLog.count({ where: { entityId: refund.id, action: "zakah_refund.rejected" } })).toBe(1);
    });

    test("zakah.fitr_campaign_approve: Shariah approves the exact proposal; the proposer can't; the database rejects checker = maker", async () => {
      const fields = { staple: "Rice", kgPerPerson: "2.5", amountPerPerson: "2500", opensOn: "2001-09-01", expectedEidOn: "2001-09-20" };
      const draft = await zakahFitrService.createDraft({ season: await unusedFitrSeason(), ...fields }, makerUserId);
      await expect(
        service.propose({ permissionKey: "zakah.fitr_campaign_approve", payload: { campaignId: draft.id, ...fields, amountPerPerson: "1" }, makerUserId }),
      ).rejects.toThrow(ConflictException);

      const action = await service.propose({ permissionKey: "zakah.fitr_campaign_approve", payload: { campaignId: draft.id, ...fields }, makerUserId });
      await expect(service.decide({ governedActionId: action.id, checkerUserId: makerUserId, approve: true })).rejects.toThrow(ForbiddenException);
      await expect(prisma.governedAction.update({ where: { id: action.id }, data: { checkerUserId: makerUserId } })).rejects.toThrow();

      await service.decide({ governedActionId: action.id, checkerUserId: beneficiaryCheckerUserId, approve: true });
      expect(await prisma.zakahFitrCampaign.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
        status: "approved",
        approvedGovernedActionId: action.id,
      });
      expect(await prisma.auditLog.count({ where: { entityId: draft.id, action: "zakah_fitr_campaign.approved", actorUserId: beneficiaryCheckerUserId } })).toBe(1);
    });

    test("zakah.metal_price_set: an invalid price can't even be proposed", async () => {
      await expect(
        service.propose({
          permissionKey: "zakah.metal_price_set",
          payload: { goldPerGram: "150000", silverPerGram: "2000", asOf: "2001-02-01", source: "Future" },
          makerUserId: investmentMakerUserId,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

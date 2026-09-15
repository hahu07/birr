import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { prisma, Prisma, GovernedActionStatus, BirrStaffRole, BeneficiaryStatus } from "@birr/db";
import { AssetsService } from "../assets/assets.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { InvestmentsService } from "../investments/investments.service";
import { CounterpartiesService } from "../counterparties/counterparties.service";
import { DistributionsService } from "../distributions/distributions.service";
import { VaultsService } from "../vaults/vaults.service";
import { VaultInvestmentsService } from "../vaults/vault-investments.service";
import { VaultDistributionsService } from "../vaults/vault-distributions.service";
import { VaultContributionsService } from "../vaults/vault-contributions.service";
import { VaultMilestonesService } from "../vaults/vault-milestones.service";
import { WaqfMilestonesService } from "../waqf-ledger/waqf-milestones.service";
import { NotificationsService } from "../notifications/notifications.service";
import { resolveFounderRecipientUserIdsForWaqf } from "../../common/notifications/resolve-founder-recipients";
import { withFounderScope } from "../../common/db/founder-scope";

function extractProposedFoundationId(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).foundationId === "string"
  ) {
    return (payload as Record<string, unknown>).foundationId as string;
  }
  return null;
}

export interface ProposeActionInput {
  permissionKey: string;
  payload: unknown;
  makerUserId: string; // derived from the authenticated BirrStaff — never client-supplied
}

export interface DecideActionInput {
  governedActionId: string;
  checkerUserId: string; // derived from the authenticated BirrStaff — never client-supplied
  approve: boolean;
}

interface FulfillmentResult {
  /** e.g. "waqf.created", "asset.disposed" — stated explicitly per handler
   * rather than derived from entityType/permission key, since that
   * derivation breaks for irregular verbs (freeze → frozen, transfer →
   * transferred). */
  auditAction: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

/**
 * One handler per permission key that this backend can actually fulfill.
 * Every seeded governed-action permission has a handler as of this
 * slice. Keeping this a plain Map built from injected services — not a
 * bigger plugin system — is deliberate: CLAUDE.md asks for a generic
 * governance engine, not bespoke per-entity branches, and this is the
 * smallest thing that satisfies that for five entries.
 *
 * Waqf/Foundation creation used to be a fifth entry here (waqf.create)
 * but is no longer a governed_actions action at all — a donor
 * self-serves establishment directly (see waqfs.controller.ts /
 * foundations.controller.ts). Every handler left in this map is
 * specifically about *ongoing* governance of an already-established
 * Waqf Fund, which stays Birr-staff-mediated.
 */
interface GovernedActionHandler {
  /** propose()-time: derive the real waqfId from the payload, never
   * trust a client-supplied one. */
  resolveWaqfId?(payload: unknown): Promise<string | undefined>;
  /**
   * Vault-scoped counterpart to resolveWaqfId above, for the Vault
   * product's own four governed-action handlers — mutually exclusive
   * with resolveWaqfId in practice (a given handler resolves one or the
   * other, never both, since no entity belongs to both a Waqf and a
   * Vault), but kept as a separate optional hook rather than unifying
   * them under one "resolveScopeId" so each stays a plain, obviously
   * correct one-liner in its own handler.
   */
  resolveVaultId?(payload: unknown): Promise<string | undefined>;
  /**
   * propose()-time, before the row is created: reject if an equivalent
   * proposal is already pending for this same target. A target entity's
   * own status field only flips on *decide*, not on propose, so without
   * this a still-pending target can be proposed twice before either
   * proposal is decided — a second staff session, a page reload resetting
   * the propose button's own local "already proposed" state, or (for
   * counterparty.onboard) a target with no decide-until status field at
   * all. Cheap enough, and the real failure mode is bad enough (two
   * proposals racing to decide the same thing, or piling up duplicates
   * that all still need a checker's individual attention), that every
   * handler with a plausible double-propose path implements this rather
   * than relying on the target's own status as an implicit guard.
   */
  checkDuplicate?(payload: unknown): Promise<void>;
  /**
   * list()-time only, read-only: a short human-readable line identifying
   * *this specific* proposal, e.g. "NGN 62,000 → Amina Yusuf (Orphan
   * Care)". Without this, two proposals of the same permission type on
   * the same waqf by the same officer on the same day are genuinely
   * indistinguishable in the queue table — same permission, same waqf,
   * same proposer, same date — forcing an officer to expand and compare
   * raw entity ids to tell them apart. Optional because a payload with
   * no other identifying fields beyond what's already a column (e.g.
   * counterparty.onboard, whose target is the waqf-less counterparty
   * itself) doesn't need one.
   */
  describePayload?(payload: unknown): Promise<string | null>;
  /**
   * findById()-time only, read-only: the entity's current field values
   * for whichever fields this payload would change, so the Ops Console
   * can render a current → proposed diff before a checker decides.
   * Optional because a handler whose action *creates* its target rather
   * than modifying an existing one (counterparty.onboard) has no
   * "current state" to diff against. Reads via plain `prisma`, not a
   * `tx` — this only ever runs outside decide()'s transaction, on a
   * single row expand, never bundled into list().
   */
  describeCurrentState?(payload: unknown): Promise<Record<string, unknown> | null>;
  /** decide()-time, on approval, inside the same transaction. */
  onApprove(
    payload: unknown,
    tx: Prisma.TransactionClient,
  ): Promise<FulfillmentResult>;
  /**
   * decide()-time, on rejection, inside the same transaction. Optional
   * because most targets don't exist yet at proposal time (e.g.
   * counterparty.onboard's Counterparty row stays exactly as it was —
   * `pending_review`/`under_review` — whether its onboarding proposal is
   * rejected or never proposed at all, nothing to release). Distribution
   * is different: create() already makes a real row at `pending` before
   * governance ever runs, so a rejection needs to move it off that
   * status or it permanently occupies its cause's allocation ceiling
   * forever with no other way to release it (found 2026-09-04, live —
   * see DistributionsService.reject's own comment).
   */
  onReject?(
    payload: unknown,
    tx: Prisma.TransactionClient,
  ): Promise<FulfillmentResult>;
}

@Injectable()
export class GovernedActionsService {
  private readonly logger = new Logger(GovernedActionsService.name);
  private readonly handlers: Map<string, GovernedActionHandler>;

  constructor(
    private readonly assetsService: AssetsService,
    private readonly beneficiariesService: BeneficiariesService,
    private readonly investmentsService: InvestmentsService,
    private readonly counterpartiesService: CounterpartiesService,
    private readonly distributionsService: DistributionsService,
    private readonly vaultsService: VaultsService,
    private readonly vaultInvestmentsService: VaultInvestmentsService,
    private readonly vaultDistributionsService: VaultDistributionsService,
    private readonly vaultContributionsService: VaultContributionsService,
    private readonly vaultMilestonesService: VaultMilestonesService,
    private readonly waqfMilestonesService: WaqfMilestonesService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.handlers = new Map<string, GovernedActionHandler>([
      [
        "asset.dispose",
        {
          resolveWaqfId: async (payload) => {
            const { assetId } = payload as { assetId: string };
            const asset = await this.assetsService.findById(assetId);
            return asset?.waqfId;
          },
          checkDuplicate: async (payload) => {
            const { assetId } = payload as { assetId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "asset.dispose" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["assetId"], equals: assetId } },
            });
            if (existing) {
              throw new ConflictException(
                "A disposal proposal for this asset is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { assetId } = payload as { assetId: string };
            const asset = await prisma.asset.findUnique({ where: { id: assetId } });
            return asset ? `${asset.name} (est. ${asset.estimatedValue})` : `Asset "${assetId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { assetId } = payload as { assetId: string };
            const asset = await prisma.asset.findUnique({ where: { id: assetId } });
            return asset ? { status: asset.status, disposedAt: asset.disposedAt } : null;
          },
          onApprove: async (payload, tx) => {
            const { assetId } = payload as { assetId: string };
            const before = await tx.asset.findUnique({ where: { id: assetId } });
            const asset = await this.assetsService.dispose(assetId, tx);
            return {
              auditAction: "asset.disposed",
              entityType: "Asset",
              entityId: asset.id,
              before,
              after: asset,
            };
          },
        },
      ],
      [
        "beneficiary.criteria_update",
        {
          resolveWaqfId: async (payload) => {
            const { beneficiaryId } = payload as { beneficiaryId: string };
            const beneficiary = await this.beneficiariesService.findById(beneficiaryId);
            return beneficiary?.waqfId;
          },
          checkDuplicate: async (payload) => {
            const { beneficiaryId } = payload as { beneficiaryId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "beneficiary.criteria_update" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["beneficiaryId"], equals: beneficiaryId } },
            });
            if (existing) {
              throw new ConflictException(
                "A criteria-update proposal for this beneficiary is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { beneficiaryId, newCriteria } = payload as { beneficiaryId: string; newCriteria: string };
            const beneficiary = await prisma.beneficiary.findUnique({ where: { id: beneficiaryId } });
            return beneficiary
              ? `${beneficiary.name}: "${newCriteria}"`
              : `Beneficiary "${beneficiaryId}" not found.`;
          },
          // Only the field this payload would change, not the full row —
          // no bankDetailsEncrypted concern here since it's never selected
          // in the first place (contrast with onApprove's before/after
          // snapshots below, which read the full row for the audit log
          // and must actively strip it).
          describeCurrentState: async (payload) => {
            const { beneficiaryId } = payload as { beneficiaryId: string };
            const beneficiary = await prisma.beneficiary.findUnique({
              where: { id: beneficiaryId },
              select: { eligibilityCriteria: true },
            });
            return beneficiary ? { newCriteria: beneficiary.eligibilityCriteria } : null;
          },
          onApprove: async (payload, tx) => {
            const { beneficiaryId, newCriteria } = payload as {
              beneficiaryId: string;
              newCriteria: string;
            };
            const beforeRow = await tx.beneficiary.findUnique({ where: { id: beneficiaryId } });
            const beneficiary = await this.beneficiariesService.updateCriteria(
              beneficiaryId,
              newCriteria,
              tx,
            );
            // bankDetailsEncrypted excluded from both snapshots —
            // see BeneficiariesService.create's identical reasoning.
            const { bankDetailsEncrypted: _afterBankDetails, ...auditSafeAfter } = beneficiary;
            let auditSafeBefore: Record<string, unknown> | null = null;
            if (beforeRow) {
              const { bankDetailsEncrypted: _beforeBankDetails, ...rest } = beforeRow;
              auditSafeBefore = rest;
            }
            return {
              auditAction: "beneficiary.criteria_updated",
              entityType: "Beneficiary",
              entityId: beneficiary.id,
              before: auditSafeBefore,
              after: auditSafeAfter,
            };
          },
        },
      ],
      [
        "beneficiary.status_change",
        {
          resolveWaqfId: async (payload) => {
            const { beneficiaryId } = payload as { beneficiaryId: string };
            const beneficiary = await this.beneficiariesService.findById(beneficiaryId);
            return beneficiary?.waqfId;
          },
          checkDuplicate: async (payload) => {
            const { beneficiaryId } = payload as { beneficiaryId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "beneficiary.status_change" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["beneficiaryId"], equals: beneficiaryId } },
            });
            if (existing) {
              throw new ConflictException(
                "A status-change proposal for this beneficiary is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { beneficiaryId, newStatus } = payload as { beneficiaryId: string; newStatus: BeneficiaryStatus };
            const beneficiary = await prisma.beneficiary.findUnique({ where: { id: beneficiaryId } });
            return beneficiary
              ? `${beneficiary.name} → ${newStatus}`
              : `Beneficiary "${beneficiaryId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { beneficiaryId } = payload as { beneficiaryId: string };
            const beneficiary = await prisma.beneficiary.findUnique({
              where: { id: beneficiaryId },
              select: { status: true },
            });
            return beneficiary ? { newStatus: beneficiary.status } : null;
          },
          onApprove: async (payload, tx) => {
            const { beneficiaryId, newStatus } = payload as {
              beneficiaryId: string;
              newStatus: BeneficiaryStatus;
            };
            const beforeRow = await tx.beneficiary.findUnique({ where: { id: beneficiaryId } });
            const beneficiary = await this.beneficiariesService.updateStatus(beneficiaryId, newStatus, tx);
            const { bankDetailsEncrypted: _afterBankDetails, ...auditSafeAfter } = beneficiary;
            let auditSafeBefore: Record<string, unknown> | null = null;
            if (beforeRow) {
              const { bankDetailsEncrypted: _beforeBankDetails, ...rest } = beforeRow;
              auditSafeBefore = rest;
            }
            return {
              auditAction: "beneficiary.status_changed",
              entityType: "Beneficiary",
              entityId: beneficiary.id,
              before: auditSafeBefore,
              after: auditSafeAfter,
            };
          },
        },
      ],
      [
        "investment.change",
        {
          resolveWaqfId: async (payload) => {
            const { investmentId } = payload as { investmentId: string };
            const investment = await this.investmentsService.findById(investmentId);
            return investment?.waqfId;
          },
          checkDuplicate: async (payload) => {
            const { investmentId } = payload as { investmentId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "investment.change" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["investmentId"], equals: investmentId } },
            });
            if (existing) {
              throw new ConflictException(
                "An allocation-change proposal for this investment is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { investmentId, newAllocatedAmount } = payload as {
              investmentId: string;
              newAllocatedAmount: string | number;
            };
            const investment = await prisma.investment.findUnique({ where: { id: investmentId } });
            return investment
              ? `${investment.name}: ${investment.allocatedAmount} → ${newAllocatedAmount}`
              : `Investment "${investmentId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { investmentId } = payload as { investmentId: string };
            const investment = await prisma.investment.findUnique({
              where: { id: investmentId },
              select: { allocatedAmount: true },
            });
            return investment ? { newAllocatedAmount: investment.allocatedAmount } : null;
          },
          onApprove: async (payload, tx) => {
            const { investmentId, newAllocatedAmount } = payload as {
              investmentId: string;
              newAllocatedAmount: string | number;
            };
            const before = await tx.investment.findUnique({ where: { id: investmentId } });
            const investment = await this.investmentsService.changeAllocation(
              investmentId,
              newAllocatedAmount,
              tx,
            );
            return {
              auditAction: "investment.allocation_changed",
              entityType: "Investment",
              entityId: investment.id,
              before,
              after: investment,
            };
          },
        },
      ],
      [
        "counterparty.onboard",
        {
          // No resolveWaqfId — a Counterparty is a global registry entry,
          // not scoped to one waqf (same as the historical waqf.create
          // handler this map used to have). waqfId stays null on the
          // resulting GovernedAction row; notifyDecision() already
          // handles that case (no founder-side fan-out, in-app only to
          // the maker).
          checkDuplicate: async (payload) => {
            const { counterpartyId } = payload as { counterpartyId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "counterparty.onboard" } });
            const existing = await prisma.governedAction.findFirst({
              where: {
                permissionId: permission?.id,
                status: "proposed",
                payload: { path: ["counterpartyId"], equals: counterpartyId },
              },
            });
            if (existing) {
              throw new ConflictException(
                "An onboarding proposal for this counterparty is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          // Not just belt-and-suspenders alongside checkDuplicate above:
          // that guard only rules out two proposals for the *same*
          // counterparty — two different counterparties both awaiting
          // onboarding still show identically as "Counterparty · Onboard
          // / Not yet created / <proposer> / <date>" without this, since
          // the counterparty's own name appears nowhere else in the row.
          describePayload: async (payload) => {
            const { counterpartyId } = payload as { counterpartyId: string };
            const counterparty = await prisma.counterparty.findUnique({ where: { id: counterpartyId } });
            return counterparty ? counterparty.name : `Counterparty "${counterpartyId}" not found.`;
          },
          onApprove: async (payload, tx) => {
            const { counterpartyId } = payload as { counterpartyId: string };
            const before = await tx.counterparty.findUnique({ where: { id: counterpartyId } });
            const counterparty = await this.counterpartiesService.onboard(counterpartyId, tx);
            return {
              auditAction: "counterparty.onboarded",
              entityType: "Counterparty",
              entityId: counterparty.id,
              before,
              after: counterparty,
            };
          },
        },
      ],
      [
        "distribution.approve",
        {
          resolveWaqfId: async (payload) => {
            const { distributionId } = payload as { distributionId: string };
            const distribution = await this.distributionsService.findById(distributionId);
            return distribution?.waqfId;
          },
          // Distribution.status alone doesn't prevent this in practice —
          // it only flips on *decide*, not propose, so the same still-
          // "pending" distribution can be proposed twice (e.g. a second
          // staff session, or a page reload resetting the propose
          // button's own local "already proposed" state) before either
          // proposal is decided. Mirrors counterparty.onboard's own
          // checkDuplicate for the identical reason.
          checkDuplicate: async (payload) => {
            const { distributionId } = payload as { distributionId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "distribution.approve" } });
            const existing = await prisma.governedAction.findFirst({
              where: {
                permissionId: permission?.id,
                status: "proposed",
                payload: { path: ["distributionId"], equals: distributionId },
              },
            });
            if (existing) {
              throw new ConflictException(
                "An approval proposal for this distribution is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { distributionId } = payload as { distributionId: string };
            const distribution = await prisma.distribution.findUnique({
              where: { id: distributionId },
              include: { beneficiary: { select: { name: true } }, cause: { select: { name: true } } },
            });
            return distribution
              ? `${distribution.currency} ${distribution.amount} → ${distribution.beneficiary.name} (${distribution.cause.name})`
              : `Distribution "${distributionId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { distributionId } = payload as { distributionId: string };
            const distribution = await prisma.distribution.findUnique({
              where: { id: distributionId },
              select: { status: true, amount: true, currency: true },
            });
            return distribution ? { ...distribution } : null;
          },
          onApprove: async (payload, tx) => {
            const { distributionId } = payload as { distributionId: string };
            const before = await tx.distribution.findUnique({ where: { id: distributionId } });
            const distribution = await this.distributionsService.approve(distributionId, tx);
            return {
              auditAction: "distribution.approved",
              entityType: "Distribution",
              entityId: distribution.id,
              before,
              after: distribution,
            };
          },
          onReject: async (payload, tx) => {
            const { distributionId } = payload as { distributionId: string };
            const before = await tx.distribution.findUnique({ where: { id: distributionId } });
            const distribution = await this.distributionsService.reject(distributionId, tx);
            return {
              auditAction: "distribution.rejected",
              entityType: "Distribution",
              entityId: distribution.id,
              before,
              after: distribution,
            };
          },
        },
      ],
      // ---- Vault handlers below — see schema.prisma's own Vault
      // section comment: a separate product from everything above, no
      // Founder involved. All five are governed specifically because
      // there's no Founder to hold the self-service half of these
      // decisions the way WaqfCause.allocatedAmount/Investment do, and
      // it's public money — vault.publish additionally because it's the
      // moment Birr's brand starts soliciting the public at all (see
      // VaultsService.publish's own comment). ----
      [
        "vault.publish",
        {
          resolveVaultId: async (payload) => {
            const { vaultId } = payload as { vaultId: string };
            return vaultId;
          },
          checkDuplicate: async (payload) => {
            const { vaultId } = payload as { vaultId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "vault.publish" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["vaultId"], equals: vaultId } },
            });
            if (existing) {
              throw new ConflictException(
                "A publish proposal for this vault is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { vaultId } = payload as { vaultId: string };
            const vault = await prisma.vault.findUnique({ where: { id: vaultId } });
            return vault
              ? `Publish "${vault.name}" — starts accepting public contributions.`
              : `Vault "${vaultId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { vaultId } = payload as { vaultId: string };
            const vault = await prisma.vault.findUnique({ where: { id: vaultId }, select: { status: true } });
            return vault ? { ...vault } : null;
          },
          onApprove: async (payload, tx) => {
            const { vaultId } = payload as { vaultId: string };
            const before = await tx.vault.findUnique({ where: { id: vaultId } });
            const vault = await this.vaultsService.publish(vaultId, tx);
            return {
              auditAction: "vault.published",
              entityType: "Vault",
              entityId: vault.id,
              before,
              after: vault,
            };
          },
        },
      ],
      [
        "vault.cause_allocate",
        {
          resolveVaultId: async (payload) => {
            const { vaultCauseId } = payload as { vaultCauseId: string };
            const cause = await prisma.vaultCause.findUnique({ where: { id: vaultCauseId } });
            return cause?.vaultId;
          },
          checkDuplicate: async (payload) => {
            const { vaultCauseId } = payload as { vaultCauseId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "vault.cause_allocate" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["vaultCauseId"], equals: vaultCauseId } },
            });
            if (existing) {
              throw new ConflictException(
                "A cause-allocation proposal for this vault cause is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { vaultCauseId, newAllocatedAmount } = payload as { vaultCauseId: string; newAllocatedAmount: string | number };
            const cause = await prisma.vaultCause.findUnique({ where: { id: vaultCauseId } });
            return cause
              ? `${cause.name}: ${cause.allocatedAmount ?? 0} → ${newAllocatedAmount}`
              : `VaultCause "${vaultCauseId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { vaultCauseId } = payload as { vaultCauseId: string };
            const cause = await prisma.vaultCause.findUnique({ where: { id: vaultCauseId }, select: { allocatedAmount: true } });
            return cause ? { newAllocatedAmount: cause.allocatedAmount } : null;
          },
          onApprove: async (payload, tx) => {
            const { vaultCauseId, newAllocatedAmount } = payload as { vaultCauseId: string; newAllocatedAmount: string | number };
            const before = await tx.vaultCause.findUnique({ where: { id: vaultCauseId } });
            const cause = await this.vaultsService.setCauseAllocation(vaultCauseId, newAllocatedAmount, tx);
            return {
              auditAction: "vault_cause.allocation_set",
              entityType: "VaultCause",
              entityId: cause.id,
              before,
              after: cause,
            };
          },
        },
      ],
      [
        "vault.proceeds_allocate",
        {
          resolveVaultId: async (payload) => {
            const { vaultCauseId } = payload as { vaultCauseId: string };
            const cause = await prisma.vaultCause.findUnique({ where: { id: vaultCauseId } });
            return cause?.vaultId;
          },
          checkDuplicate: async (payload) => {
            const { vaultCauseId } = payload as { vaultCauseId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "vault.proceeds_allocate" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["vaultCauseId"], equals: vaultCauseId } },
            });
            if (existing) {
              throw new ConflictException(
                "A proceeds-allocation proposal for this vault cause is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { vaultCauseId, newProceedsAllocatedAmount } = payload as {
              vaultCauseId: string;
              newProceedsAllocatedAmount: string | number;
            };
            const cause = await prisma.vaultCause.findUnique({ where: { id: vaultCauseId } });
            return cause
              ? `${cause.name}: ${cause.proceedsAllocatedAmount ?? 0} → ${newProceedsAllocatedAmount}`
              : `VaultCause "${vaultCauseId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { vaultCauseId } = payload as { vaultCauseId: string };
            const cause = await prisma.vaultCause.findUnique({
              where: { id: vaultCauseId },
              select: { proceedsAllocatedAmount: true },
            });
            return cause ? { newProceedsAllocatedAmount: cause.proceedsAllocatedAmount } : null;
          },
          onApprove: async (payload, tx) => {
            const { vaultCauseId, newProceedsAllocatedAmount } = payload as {
              vaultCauseId: string;
              newProceedsAllocatedAmount: string | number;
            };
            const before = await tx.vaultCause.findUnique({ where: { id: vaultCauseId } });
            const cause = await this.vaultsService.setCauseProceedsAllocation(vaultCauseId, newProceedsAllocatedAmount, tx);
            return {
              auditAction: "vault_cause.proceeds_allocation_set",
              entityType: "VaultCause",
              entityId: cause.id,
              before,
              after: cause,
            };
          },
        },
      ],
      [
        "vault.investment_change",
        {
          resolveVaultId: async (payload) => {
            const { vaultInvestmentId } = payload as { vaultInvestmentId: string };
            const investment = await prisma.vaultInvestment.findUnique({ where: { id: vaultInvestmentId } });
            return investment?.vaultId;
          },
          checkDuplicate: async (payload) => {
            const { vaultInvestmentId } = payload as { vaultInvestmentId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "vault.investment_change" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["vaultInvestmentId"], equals: vaultInvestmentId } },
            });
            if (existing) {
              throw new ConflictException(
                "An allocation-change proposal for this vault investment is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { vaultInvestmentId, newAllocatedAmount } = payload as {
              vaultInvestmentId: string;
              newAllocatedAmount: string | number;
            };
            const investment = await prisma.vaultInvestment.findUnique({ where: { id: vaultInvestmentId } });
            return investment
              ? `${investment.name}: ${investment.allocatedAmount} → ${newAllocatedAmount}`
              : `VaultInvestment "${vaultInvestmentId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { vaultInvestmentId } = payload as { vaultInvestmentId: string };
            const investment = await prisma.vaultInvestment.findUnique({
              where: { id: vaultInvestmentId },
              select: { allocatedAmount: true },
            });
            return investment ? { newAllocatedAmount: investment.allocatedAmount } : null;
          },
          onApprove: async (payload, tx) => {
            const { vaultInvestmentId, newAllocatedAmount } = payload as {
              vaultInvestmentId: string;
              newAllocatedAmount: string | number;
            };
            const before = await tx.vaultInvestment.findUnique({ where: { id: vaultInvestmentId } });
            const investment = await this.vaultInvestmentsService.changeAllocation(vaultInvestmentId, newAllocatedAmount, tx);
            return {
              auditAction: "vault_investment.allocation_changed",
              entityType: "VaultInvestment",
              entityId: investment.id,
              before,
              after: investment,
            };
          },
        },
      ],
      [
        "vault.distribution_approve",
        {
          resolveVaultId: async (payload) => {
            const { vaultDistributionId } = payload as { vaultDistributionId: string };
            const distribution = await prisma.vaultDistribution.findUnique({ where: { id: vaultDistributionId } });
            return distribution?.vaultId;
          },
          checkDuplicate: async (payload) => {
            const { vaultDistributionId } = payload as { vaultDistributionId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "vault.distribution_approve" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["vaultDistributionId"], equals: vaultDistributionId } },
            });
            if (existing) {
              throw new ConflictException(
                "An approval proposal for this vault distribution is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { vaultDistributionId } = payload as { vaultDistributionId: string };
            const distribution = await prisma.vaultDistribution.findUnique({
              where: { id: vaultDistributionId },
              include: { counterparty: { select: { name: true } }, vaultCause: { select: { name: true } } },
            });
            return distribution
              ? `${distribution.currency} ${distribution.amount} → ${distribution.counterparty.name} (${distribution.vaultCause.name})`
              : `VaultDistribution "${vaultDistributionId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { vaultDistributionId } = payload as { vaultDistributionId: string };
            const distribution = await prisma.vaultDistribution.findUnique({
              where: { id: vaultDistributionId },
              select: { status: true, amount: true, currency: true },
            });
            return distribution ? { ...distribution } : null;
          },
          onApprove: async (payload, tx) => {
            const { vaultDistributionId } = payload as { vaultDistributionId: string };
            const before = await tx.vaultDistribution.findUnique({ where: { id: vaultDistributionId } });
            const distribution = await this.vaultDistributionsService.approve(vaultDistributionId, tx);
            return {
              auditAction: "vault_distribution.approved",
              entityType: "VaultDistribution",
              entityId: distribution.id,
              before,
              after: distribution,
            };
          },
          onReject: async (payload, tx) => {
            const { vaultDistributionId } = payload as { vaultDistributionId: string };
            const before = await tx.vaultDistribution.findUnique({ where: { id: vaultDistributionId } });
            const distribution = await this.vaultDistributionsService.reject(vaultDistributionId, tx);
            return {
              auditAction: "vault_distribution.rejected",
              entityType: "VaultDistribution",
              entityId: distribution.id,
              before,
              after: distribution,
            };
          },
        },
      ],
      // Same fiduciary weight as vault.distribution_approve above —
      // verifying a project milestone's real-world completion before
      // the tranche it unlocks can even be created
      // (VaultDistributionsService.create()'s own milestone-completion
      // gate), not a status label a single staff member could set
      // unilaterally. No onReject, matching vault.contribution_refund's
      // own precedent just above — a rejection leaves the milestone
      // exactly as it was; nothing about it actually changed, so the
      // governed_action's own decide()-level audit log is enough.
      [
        "vault.milestone_complete",
        {
          resolveVaultId: async (payload) => {
            const { vaultMilestoneId } = payload as { vaultMilestoneId: string };
            const milestone = await prisma.vaultMilestone.findUnique({ where: { id: vaultMilestoneId } });
            return milestone?.vaultId;
          },
          checkDuplicate: async (payload) => {
            const { vaultMilestoneId } = payload as { vaultMilestoneId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "vault.milestone_complete" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["vaultMilestoneId"], equals: vaultMilestoneId } },
            });
            if (existing) {
              throw new ConflictException(
                "A completion proposal for this milestone is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { vaultMilestoneId } = payload as { vaultMilestoneId: string };
            const milestone = await prisma.vaultMilestone.findUnique({
              where: { id: vaultMilestoneId },
              include: { vault: { select: { name: true } } },
            });
            return milestone
              ? `Mark "${milestone.name}" complete for "${milestone.vault.name}".`
              : `VaultMilestone "${vaultMilestoneId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { vaultMilestoneId } = payload as { vaultMilestoneId: string };
            const milestone = await prisma.vaultMilestone.findUnique({
              where: { id: vaultMilestoneId },
              select: { status: true, targetAmount: true, evidenceNotes: true },
            });
            return milestone ? { ...milestone } : null;
          },
          onApprove: async (payload, tx) => {
            const { vaultMilestoneId } = payload as { vaultMilestoneId: string };
            const before = await tx.vaultMilestone.findUnique({ where: { id: vaultMilestoneId } });
            const milestone = await this.vaultMilestonesService.complete(vaultMilestoneId, tx);
            return {
              auditAction: "vault_milestone.completed",
              entityType: "VaultMilestone",
              entityId: milestone.id,
              before,
              after: milestone,
            };
          },
        },
      ],
      // Founder/Waqf-side counterpart to vault.milestone_complete above
      // (2026-09-15, ported alongside the rest of the Waqf ledger/
      // milestone slice — see WaqfLedgerAccount's own schema comment).
      // Same fiduciary weight as distribution.approve — verifying a
      // project milestone's real-world completion before the tranche it
      // unlocks can even be created (DistributionsService.create()'s own
      // milestone-completion gate). No onReject, same precedent as
      // vault.milestone_complete — a rejection leaves the milestone
      // exactly as it was.
      [
        "waqf.milestone_complete",
        {
          resolveWaqfId: async (payload) => {
            const { waqfMilestoneId } = payload as { waqfMilestoneId: string };
            const milestone = await prisma.waqfMilestone.findUnique({ where: { id: waqfMilestoneId } });
            return milestone?.waqfId;
          },
          checkDuplicate: async (payload) => {
            const { waqfMilestoneId } = payload as { waqfMilestoneId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "waqf.milestone_complete" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["waqfMilestoneId"], equals: waqfMilestoneId } },
            });
            if (existing) {
              throw new ConflictException(
                "A completion proposal for this milestone is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { waqfMilestoneId } = payload as { waqfMilestoneId: string };
            const milestone = await prisma.waqfMilestone.findUnique({
              where: { id: waqfMilestoneId },
              include: { waqf: { select: { name: true } } },
            });
            return milestone
              ? `Mark "${milestone.name}" complete for "${milestone.waqf.name}".`
              : `WaqfMilestone "${waqfMilestoneId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { waqfMilestoneId } = payload as { waqfMilestoneId: string };
            const milestone = await prisma.waqfMilestone.findUnique({
              where: { id: waqfMilestoneId },
              select: { status: true, targetAmount: true, evidenceNotes: true },
            });
            return milestone ? { ...milestone } : null;
          },
          onApprove: async (payload, tx) => {
            const { waqfMilestoneId } = payload as { waqfMilestoneId: string };
            const before = await tx.waqfMilestone.findUnique({ where: { id: waqfMilestoneId } });
            const milestone = await this.waqfMilestonesService.complete(waqfMilestoneId, tx);
            return {
              auditAction: "waqf_milestone.completed",
              entityType: "WaqfMilestone",
              entityId: milestone.id,
              before,
              after: milestone,
            };
          },
        },
      ],
      // Reversing a confirmed public gift is symmetrically the same
      // class of decision as vault.distribution_approve above (real
      // money moving), and gated the same way — see
      // VaultContributionsService.requestRefund's own comment on why
      // this only records the decision here; the real external refund
      // call happens in initiateRefund(), fired fire-and-forget below,
      // after this transaction commits.
      [
        "vault.contribution_refund",
        {
          resolveVaultId: async (payload) => {
            const { vaultContributionId } = payload as { vaultContributionId: string };
            const contribution = await prisma.vaultContribution.findUnique({ where: { id: vaultContributionId } });
            return contribution?.vaultId;
          },
          checkDuplicate: async (payload) => {
            const { vaultContributionId } = payload as { vaultContributionId: string };
            const permission = await prisma.permission.findUnique({ where: { key: "vault.contribution_refund" } });
            const existing = await prisma.governedAction.findFirst({
              where: { permissionId: permission?.id, status: "proposed", payload: { path: ["vaultContributionId"], equals: vaultContributionId } },
            });
            if (existing) {
              throw new ConflictException(
                "A refund proposal for this contribution is already awaiting a decision — check the Approvals queue instead of proposing again.",
              );
            }
          },
          describePayload: async (payload) => {
            const { vaultContributionId } = payload as { vaultContributionId: string };
            const contribution = await prisma.vaultContribution.findUnique({
              where: { id: vaultContributionId },
              include: { donor: { select: { email: true } }, vault: { select: { name: true } } },
            });
            return contribution
              ? `Refund ${contribution.currency} ${contribution.amount} to ${contribution.donor?.email ?? "an anonymous donor"} for "${contribution.vault.name}".`
              : `VaultContribution "${vaultContributionId}" not found.`;
          },
          describeCurrentState: async (payload) => {
            const { vaultContributionId } = payload as { vaultContributionId: string };
            const contribution = await prisma.vaultContribution.findUnique({
              where: { id: vaultContributionId },
              select: { status: true, heldAt: true, refundStatus: true },
            });
            return contribution ? { ...contribution } : null;
          },
          onApprove: async (payload, tx) => {
            const { vaultContributionId } = payload as { vaultContributionId: string };
            const before = await tx.vaultContribution.findUnique({ where: { id: vaultContributionId } });
            const contribution = await this.vaultContributionsService.requestRefund(vaultContributionId, tx);
            return {
              auditAction: "vault_contribution.refund_requested",
              entityType: "VaultContribution",
              entityId: contribution.id,
              before,
              after: contribution,
            };
          },
        },
      ],
    ]);
  }

  /**
   * Every fiduciary write in Birr goes through this service, not a direct
   * Prisma call from a feature module. That's what keeps the maker/checker
   * guarantee in one place instead of re-implemented per module.
   *
   * Only supports human makers for now — agent-initiated proposals need
   * services/agents' own credential scheme, which doesn't exist yet.
   */
  async propose(input: ProposeActionInput) {
    const permission = await prisma.permission.findUnique({
      where: { key: input.permissionKey },
    });
    if (!permission) {
      throw new NotFoundException(`Unknown permission "${input.permissionKey}".`);
    }
    if (!permission.requiresMakerChecker) {
      throw new BadRequestException(
        `"${input.permissionKey}" is not a governed action (requiresMakerChecker is false).`,
      );
    }
    if (!this.handlers.has(input.permissionKey)) {
      // A permission row can outlive its handler — e.g. waqf.create's
      // Permission row is never deleted (existing governed_actions
      // history still references it, and that history is never erased),
      // even though its handler was removed once waqf establishment
      // became donor self-service. Without this check, that stale row
      // would let someone propose a new action that silently no-ops on
      // approval — nothing would actually happen, with no indication why.
      throw new BadRequestException(
        `"${input.permissionKey}" has no configured fulfillment handler and cannot be proposed.`,
      );
    }

    const handler = this.handlers.get(input.permissionKey)!;
    await handler.checkDuplicate?.(input.payload);
    const waqfId = await handler.resolveWaqfId?.(input.payload);
    const vaultId = await handler.resolveVaultId?.(input.payload);

    const action = await prisma.$transaction(async (tx) => {
      const action = await tx.governedAction.create({
        data: {
          waqfId,
          vaultId,
          permissionId: permission.id,
          payload: input.payload as any,
          makerType: "human",
          makerUserId: input.makerUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          waqfId,
          vaultId,
          actorType: "birr_staff",
          actorUserId: input.makerUserId,
          action: "governed_action.proposed",
          entityType: "GovernedAction",
          entityId: action.id,
          after: action as any,
        },
      });

      return action;
    });

    // Deliberately NOT awaited, unlike InvitationsService.invite()'s
    // single-recipient email send — propose() can fan out to every
    // active staff member in every checker-eligible role, so the
    // proposer's own request must not block on N real network calls to
    // Resend/Twilio. Still can't silently swallow a broken promise
    // chain, so the rejection is still caught and logged here.
    this.notifyProposed(action, permission).catch((err) => {
      this.logger.error(
        `Failed to notify checkers for governed action "${action.id}":`,
        err instanceof Error ? err.stack : String(err),
      );
    });

    return action;
  }

  /**
   * Notifies every active Birr staff member in a role eligible to check
   * this permission (role_permissions.canChecker — same lookup
   * PermissionGuard does at decide()-time), excluding the maker
   * themselves even if their own role would otherwise qualify — they
   * can't decide their own proposal (checker_not_maker), so telling them
   * to review it would just be confusing noise.
   */
  private async notifyProposed(
    action: { id: string; makerUserId: string | null },
    permission: { id: string; key: string },
  ): Promise<void> {
    const eligibleRolePermissions = await prisma.rolePermission.findMany({
      where: { permissionId: permission.id, canChecker: true },
      select: { roleId: true },
    });
    if (eligibleRolePermissions.length === 0) return;

    const roles = await prisma.role.findMany({
      where: { id: { in: eligibleRolePermissions.map((rp) => rp.roleId) } },
      select: { key: true },
    });
    if (roles.length === 0) return;

    const checkers = await prisma.birrStaff.findMany({
      where: {
        staffRole: { in: roles.map((r) => r.key as BirrStaffRole) },
        status: "active",
        ...(action.makerUserId ? { userId: { not: action.makerUserId } } : {}),
      },
      select: { userId: true },
    });

    await Promise.all(
      checkers.map((staff) =>
        this.notificationsService.notify({
          recipientType: "birr_staff",
          recipientUserId: staff.userId,
          type: "governed_action.proposed",
          title: "Action awaiting your review",
          body: `A "${permission.key}" action is proposed and needs a checker.`,
          linkUrl: "/ops/governed-actions",
          relatedEntityType: "GovernedAction",
          relatedEntityId: action.id,
        }),
      ),
    );
  }

  async decide(input: DecideActionInput) {
    const action = await prisma.governedAction.findUnique({
      where: { id: input.governedActionId },
      include: { permission: true },
    });
    if (!action) {
      throw new NotFoundException(
        `Governed action "${input.governedActionId}" not found.`,
      );
    }
    if (action.status !== "proposed") {
      throw new BadRequestException(
        `Governed action "${action.id}" has already been decided (status: ${action.status}).`,
      );
    }

    // This check duplicates the DB constraint deliberately — fail with a
    // clear application error before ever hitting the DB, but never treat
    // this app-layer check as the actual guarantee. The checker_not_maker
    // constraint in packages/db/prisma/migrations/20260731201431_governed_actions_constraints/
    // is the real enforcement.
    if (action.makerUserId && action.makerUserId === input.checkerUserId) {
      throw new ForbiddenException(
        "The proposer of this action cannot also be its approver.",
      );
    }
    // Rejecting a legacy action whose handler no longer exists (e.g. an
    // old waqf.create row) is harmless cleanup and stays allowed —
    // approving one would silently no-op instead of doing what the
    // checker expects, so that specific path is blocked with a clear
    // error rather than pretending to succeed.
    if (input.approve && !this.handlers.has(action.permission.key)) {
      throw new BadRequestException(
        `"${action.permission.key}" has no configured fulfillment handler anymore and can no longer be approved — it can still be rejected.`,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const status = input.approve ? "approved" : "rejected";
      // Atomic claim, not a plain update: the `status: "proposed"` in this
      // WHERE clause is what actually closes the race the outer check above
      // can't — two concurrent decide() calls both pass that outer read,
      // but only one of these single-statement updates can match a row
      // still "proposed", so only one caller proceeds to run the
      // fulfillment handler below. The other gets count 0 and rolls back
      // its whole transaction before any side effect fires.
      const claim = await tx.governedAction.updateMany({
        where: { id: action.id, status: "proposed" },
        data: {
          status,
          checkerUserId: input.checkerUserId,
          decidedAt: new Date(),
        },
      });
      if (claim.count !== 1) {
        throw new BadRequestException(
          `Governed action "${action.id}" has already been decided.`,
        );
      }
      const decided = await tx.governedAction.findUniqueOrThrow({ where: { id: action.id } });

      await tx.auditLog.create({
        data: {
          waqfId: action.waqfId,
          vaultId: action.vaultId,
          actorType: "birr_staff",
          actorUserId: input.checkerUserId,
          action: `governed_action.${status}`,
          entityType: "GovernedAction",
          entityId: action.id,
          before: action as any,
          after: decided as any,
        },
      });

      let fulfillment: FulfillmentResult | undefined;
      const handler = this.handlers.get(action.permission.key);
      if (handler) {
        // onReject is optional (most targets don't exist yet at proposal
        // time, so rejection has nothing to release — see
        // GovernedActionHandler.onReject's own comment); onApprove is
        // required, so approval always has a handler to call once
        // `handler` itself resolved.
        if (input.approve) {
          fulfillment = await handler.onApprove(action.payload, tx);
        } else if (handler.onReject) {
          fulfillment = await handler.onReject(action.payload, tx);
        }
        if (fulfillment) {
          await tx.auditLog.create({
            data: {
              waqfId: action.waqfId,
              vaultId: action.vaultId,
              actorType: "birr_staff",
              actorUserId: input.checkerUserId,
              action: fulfillment.auditAction,
              entityType: fulfillment.entityType,
              entityId: fulfillment.entityId,
              before: fulfillment.before as any,
              after: fulfillment.after as any,
            },
          });
        }
      }

      return { governedAction: decided, fulfillment };
    });

    // Deliberately NOT awaited — see the matching comment in propose().
    // decide() typically fans out to fewer recipients (the maker plus a
    // handful of founder members) than propose() does, but the same
    // "don't make a governance decision wait on Resend/Twilio" reasoning
    // applies either way.
    this.notifyDecision(action, result.governedAction, result.fulfillment).catch((err) => {
      this.logger.error(
        `Failed to notify on decision for governed action "${action.id}":`,
        err instanceof Error ? err.stack : String(err),
      );
    });

    // Same fire-and-forget, post-commit posture as notifyDecision above
    // — a real Paystack HTTP call must never happen inside the DB
    // transaction just committed. initiateDisbursement never throws
    // past its own boundary (a real failure is caught and recorded as
    // payout_failed internally), so this .catch() only needs to log
    // genuinely unexpected errors.
    if (input.approve && result.fulfillment?.entityType === "Distribution") {
      this.distributionsService.initiateDisbursement(result.fulfillment.entityId).catch((err) => {
        this.logger.error(
          `Failed to initiate disbursement for distribution "${result.fulfillment!.entityId}":`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    }
    // Vault counterpart to the block above — same fire-and-forget,
    // post-commit posture, same never-throws-past-its-own-boundary
    // guarantee from VaultDistributionsService.initiateDisbursement.
    if (input.approve && result.fulfillment?.entityType === "VaultDistribution") {
      this.vaultDistributionsService.initiateDisbursement(result.fulfillment.entityId).catch((err) => {
        this.logger.error(
          `Failed to initiate disbursement for vault distribution "${result.fulfillment!.entityId}":`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    }
    // Same fire-and-forget, post-commit posture, same never-throws-past-
    // its-own-boundary guarantee from
    // VaultContributionsService.initiateRefund.
    if (input.approve && result.fulfillment?.entityType === "VaultContribution") {
      this.vaultContributionsService.initiateRefund(result.fulfillment.entityId).catch((err) => {
        this.logger.error(
          `Failed to initiate refund for vault contribution "${result.fulfillment!.entityId}":`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    }

    return result;
  }

  /**
   * Closes the loop on both sides of a decision: the human maker gets an
   * in-app-only "here's what happened to your proposal" (not
   * time-sensitive the way the original proposal was — see
   * CHANNEL_PLAN), and every active member of the Founder(s) whose Waqf
   * Fund this action affects gets an in-app + email notification. A
   * legacy waqf.create-shaped action with no real waqf yet
   * (action.waqfId is null) has no founder to notify — establishment
   * itself is no longer a governed_actions concept at all, so this can
   * only be old history, and is skipped entirely.
   */
  private async notifyDecision(
    action: {
      id: string;
      waqfId: string | null;
      makerType: string;
      makerUserId: string | null;
      permission: { key: string };
    },
    decided: { status: string },
    fulfillment: FulfillmentResult | undefined,
  ): Promise<void> {
    if (action.makerType === "human" && action.makerUserId) {
      await this.notificationsService.notify({
        recipientType: "birr_staff",
        recipientUserId: action.makerUserId,
        type: "governed_action.decided.own",
        title: `Your proposal was ${decided.status}`,
        body: `The "${action.permission.key}" action you proposed was ${decided.status}.`,
        linkUrl: "/ops/governed-actions",
        relatedEntityType: "GovernedAction",
        relatedEntityId: action.id,
      });
    }

    if (!action.waqfId) return;

    const waqf = await prisma.waqf.findUnique({ where: { id: action.waqfId }, select: { name: true } });
    if (!waqf) return;

    const recipientUserIds = await resolveFounderRecipientUserIdsForWaqf(action.waqfId);

    // An approved distribution gets its own richer, specific
    // notification instead of the generic "a governance action was
    // decided" one — telling a founder "$500 was approved and is being
    // paid out" is a lot more useful than "an action affecting your
    // waqf was approved." Deliberately does NOT say "was paid out" —
    // approval only starts the real payout attempt
    // (DistributionsService.initiateDisbursement, fired right after this
    // notification, post-commit); the actual "was paid out" notification
    // fires later, once a transfer.success webhook confirms it, from
    // DistributionsService.notifyPayoutOutcome. Only replaces the
    // generic notification for this one fulfillment shape; every other
    // governed-action type still gets the generic message below.
    if (decided.status === "approved" && fulfillment?.entityType === "Distribution") {
      const distribution = fulfillment.after as { amount: string; currency: string };
      await Promise.all(
        recipientUserIds.map((userId) =>
          this.notificationsService.notify({
            recipientType: "founder_user",
            recipientUserId: userId,
            type: "distribution.approved",
            title: `Distribution approved — ${waqf.name}`,
            body: `${distribution.currency} ${distribution.amount} was approved and is being paid out from ${waqf.name}.`,
            linkUrl: `/portfolio/${action.waqfId}`,
            relatedEntityType: "Distribution",
            relatedEntityId: fulfillment.entityId,
          }),
        ),
      );
      return;
    }

    await Promise.all(
      recipientUserIds.map((userId) =>
        this.notificationsService.notify({
          recipientType: "founder_user",
          recipientUserId: userId,
          type: "governed_action.decided",
          title: `Update on ${waqf.name}`,
          body: `A governance action affecting ${waqf.name} was ${decided.status}.`,
          linkUrl: `/portfolio/${action.waqfId}`,
          relatedEntityType: "GovernedAction",
          relatedEntityId: action.id,
        }),
      ),
    );
  }

  async list(filter: { status?: GovernedActionStatus; waqfId?: string }) {
    const actions = await prisma.governedAction.findMany({
      where: {
        status: filter.status,
        waqfId: filter.waqfId,
      },
      include: {
        permission: true,
        makerUser: { select: { id: true, fullName: true, email: true } },
        makerAgent: { select: { id: true, name: true } },
        checkerUser: { select: { id: true, fullName: true, email: true } },
        waqf: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const withFoundations = await this.attachProposedFoundations(actions);
    return this.attachSummaries(withFoundations);
  }

  // Founder-Portal read-only visibility into decisions Birr staff have
  // actually made on their own waqf — proposed/pending rows are
  // deliberately excluded (nothing final to show a Founder yet, and a
  // proposal could still be rejected). No raw payload here — a payload
  // can carry an internal id (e.g. beneficiaryId) that's meaningless
  // without also exposing the beneficiary lookup this codebase
  // otherwise keeps aggregate-only for Founders (see
  // BeneficiariesService.summaryForFounder's own comment); the
  // permission type, decision, and who at Birr decided it is the
  // transparency this is actually for. Same null-means-not-found-or-
  // not-theirs convention as every other founder-scoped read.
  async listDecidedForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) return null;
      return tx.governedAction.findMany({
        where: { waqfId, status: { in: ["approved", "rejected"] } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          decidedAt: true,
          permission: { select: { key: true, category: true } },
          checkerUser: { select: { id: true, fullName: true } },
        },
        orderBy: { decidedAt: "desc" },
      });
    });
  }

  async findById(id: string) {
    const action = await prisma.governedAction.findUnique({
      where: { id },
      include: {
        permission: true,
        makerUser: { select: { id: true, fullName: true, email: true } },
        makerAgent: { select: { id: true, name: true } },
        checkerUser: { select: { id: true, fullName: true, email: true } },
        waqf: { select: { id: true, name: true } },
      },
    });
    if (!action) return null;
    const [withFoundation] = await this.attachProposedFoundations([action]);
    const handler = this.handlers.get(action.permission.key);
    const currentState = (await handler?.describeCurrentState?.(action.payload)) ?? null;
    return { ...withFoundation, currentState };
  }

  /**
   * A pending waqf.create action has no waqf yet (that's the point of
   * the action), so `waqf` is always null for it — but its payload
   * carries a foundationId that IS resolvable, and knowing which
   * Foundation is proposing a new fund is genuinely useful context for a
   * checker deciding on it. `payload` is untyped JSON (no FK relation
   * exists from GovernedAction to Foundation), so this is resolved as a
   * one-shot batch lookup here rather than a Prisma `include` — one
   * extra query regardless of how many pending waqf.create rows are in
   * the batch, not N+1. Foundation ids that don't type-guard cleanly
   * (e.g. pre-existing fixture rows proposed before this field existed,
   * still carrying the old founderIds payload shape) resolve to null,
   * not an error.
   */
  private async attachProposedFoundations<
    T extends { permission: { key: string }; waqfId: string | null; payload: unknown },
  >(actions: T[]): Promise<(T & { proposedFoundation: { id: string; name: string } | null })[]> {
    const foundationIds = new Set<string>();
    for (const action of actions) {
      if (action.permission.key === "waqf.create" && !action.waqfId) {
        const foundationId = extractProposedFoundationId(action.payload);
        if (foundationId) foundationIds.add(foundationId);
      }
    }

    const foundations =
      foundationIds.size > 0
        ? await prisma.foundation.findMany({
            where: { id: { in: [...foundationIds] } },
            select: { id: true, name: true },
          })
        : [];
    const foundationById = new Map(foundations.map((f) => [f.id, f]));

    return actions.map((action) => {
      const foundationId =
        action.permission.key === "waqf.create" && !action.waqfId
          ? extractProposedFoundationId(action.payload)
          : null;
      return {
        ...action,
        proposedFoundation: foundationId ? (foundationById.get(foundationId) ?? null) : null,
      };
    });
  }

  /**
   * list()-only — resolves each action's describePayload (see that
   * hook's own comment on why this exists: without it, same-permission/
   * same-waqf/same-proposer/same-day rows are indistinguishable in the
   * queue table). One extra lookup per action with a handler that
   * implements it; harmless for the queue's typical size, and every
   * lookup already narrows to a single row by id.
   */
  private async attachSummaries<T extends { permission: { key: string }; payload: unknown }>(
    actions: T[],
  ): Promise<(T & { summary: string | null })[]> {
    return Promise.all(
      actions.map(async (action) => {
        const handler = this.handlers.get(action.permission.key);
        const summary = (await handler?.describePayload?.(action.payload)) ?? null;
        return { ...action, summary };
      }),
    );
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma, Prisma, GovernedActionStatus } from "@birr/db";
import { AssetsService } from "../assets/assets.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { InvestmentsService } from "../investments/investments.service";
import { DistributionsService } from "../distributions/distributions.service";

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
  after: unknown;
}

/**
 * One handler per permission key that this backend can actually fulfill.
 * Every seeded governed-action permission has a handler as of this
 * slice. Keeping this a plain Map built from injected services — not a
 * bigger plugin system — is deliberate: CLAUDE.md asks for a generic
 * governance engine, not bespoke per-entity branches, and this is the
 * smallest thing that satisfies that for four entries.
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
  /** decide()-time, on approval, inside the same transaction. */
  onApprove(
    payload: unknown,
    tx: Prisma.TransactionClient,
  ): Promise<FulfillmentResult>;
}

@Injectable()
export class GovernedActionsService {
  private readonly handlers: Map<string, GovernedActionHandler>;

  constructor(
    private readonly assetsService: AssetsService,
    private readonly beneficiariesService: BeneficiariesService,
    private readonly investmentsService: InvestmentsService,
    private readonly distributionsService: DistributionsService,
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
          onApprove: async (payload, tx) => {
            const { assetId } = payload as { assetId: string };
            const asset = await this.assetsService.dispose(assetId, tx);
            return {
              auditAction: "asset.disposed",
              entityType: "Asset",
              entityId: asset.id,
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
          onApprove: async (payload, tx) => {
            const { beneficiaryId, newCriteria } = payload as {
              beneficiaryId: string;
              newCriteria: string;
            };
            const beneficiary = await this.beneficiariesService.updateCriteria(
              beneficiaryId,
              newCriteria,
              tx,
            );
            return {
              auditAction: "beneficiary.criteria_updated",
              entityType: "Beneficiary",
              entityId: beneficiary.id,
              after: beneficiary,
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
          onApprove: async (payload, tx) => {
            const { investmentId, newAllocatedAmount } = payload as {
              investmentId: string;
              newAllocatedAmount: string | number;
            };
            const investment = await this.investmentsService.changeAllocation(
              investmentId,
              newAllocatedAmount,
              tx,
            );
            return {
              auditAction: "investment.allocation_changed",
              entityType: "Investment",
              entityId: investment.id,
              after: investment,
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
          onApprove: async (payload, tx) => {
            const { distributionId } = payload as { distributionId: string };
            const distribution = await this.distributionsService.approve(distributionId, tx);
            return {
              auditAction: "distribution.approved",
              entityType: "Distribution",
              entityId: distribution.id,
              after: distribution,
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

    const waqfId = await this.handlers
      .get(input.permissionKey)
      ?.resolveWaqfId?.(input.payload);

    return prisma.$transaction(async (tx) => {
      const action = await tx.governedAction.create({
        data: {
          waqfId,
          permissionId: permission.id,
          payload: input.payload as any,
          makerType: "human",
          makerUserId: input.makerUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          waqfId,
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

    return prisma.$transaction(async (tx) => {
      const status = input.approve ? "approved" : "rejected";
      const decided = await tx.governedAction.update({
        where: { id: action.id },
        data: {
          status,
          checkerUserId: input.checkerUserId,
          decidedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          waqfId: action.waqfId,
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
      if (input.approve) {
        const handler = this.handlers.get(action.permission.key);
        if (handler) {
          fulfillment = await handler.onApprove(action.payload, tx);
          await tx.auditLog.create({
            data: {
              waqfId: action.waqfId,
              actorType: "birr_staff",
              actorUserId: input.checkerUserId,
              action: fulfillment.auditAction,
              entityType: fulfillment.entityType,
              entityId: fulfillment.entityId,
              after: fulfillment.after as any,
            },
          });
        }
      }

      return { governedAction: decided, fulfillment };
    });
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
        checkerUser: { select: { id: true, fullName: true, email: true } },
        waqf: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return this.attachProposedFoundations(actions);
  }

  async findById(id: string) {
    const action = await prisma.governedAction.findUnique({
      where: { id },
      include: {
        permission: true,
        makerUser: { select: { id: true, fullName: true, email: true } },
        checkerUser: { select: { id: true, fullName: true, email: true } },
        waqf: { select: { id: true, name: true } },
      },
    });
    if (!action) return null;
    const [withFoundation] = await this.attachProposedFoundations([action]);
    return withFoundation;
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
}

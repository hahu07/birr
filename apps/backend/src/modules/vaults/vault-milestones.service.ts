import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsInt, IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { findVaultOrThrow } from "./find-vault-or-throw";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export class UpdateVaultMilestoneEvidenceInput {
  @IsOptional()
  @IsString()
  evidenceNotes?: string;
}

export class CreateVaultMilestoneInput {
  @IsString()
  vaultId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  sequence!: number;

  @IsOptional()
  @IsNumberString()
  @IsPositiveDecimal()
  targetAmount?: string;

  @IsOptional()
  @IsString()
  evidenceNotes?: string;
}

/**
 * Project-vault lifecycle tracking (2026-09-13) — investment-type
 * vaults have no construction-progress concept, so create() rejects
 * against anything but a "project" vault, same type-branching
 * precedent assertWithinAllocation already uses elsewhere for
 * investment-vs-project treatment. Plain staff CRUD to create/list, the
 * same trust tier as VaultDistributionsService.create() — the real
 * fiduciary checkpoint is completing a milestone (vault.milestone_complete,
 * a governed action — see governed-actions.service.ts), not creating
 * the tracking row itself.
 */
@Injectable()
export class VaultMilestonesService {
  async create(input: CreateVaultMilestoneInput, actorUserId: string) {
    const vault = await findVaultOrThrow(prisma, input.vaultId);
    if (vault.type !== "project") {
      throw new BadRequestException(`Milestones only apply to project-type vaults — "${vault.name}" is ${vault.type}.`);
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const milestone = await tx.vaultMilestone.create({ data: input });
        await tx.auditLog.create({
          data: {
            vaultId: input.vaultId,
            actorType: "birr_staff",
            actorUserId,
            action: "vault_milestone.created",
            entityType: "VaultMilestone",
            entityId: milestone.id,
            after: milestone as any,
          },
        });
        return milestone;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException(`This vault already has a milestone at sequence ${input.sequence}.`);
      }
      throw err;
    }
  }

  async list(vaultId: string) {
    const milestones = await prisma.vaultMilestone.findMany({ where: { vaultId, deletedAt: null }, orderBy: { sequence: "asc" } });
    return this.withActualSpend(milestones);
  }

  /**
   * Batches "how much has actually been spent against this milestone"
   * onto each row — same shape/reasoning as VaultsService
   * .withAmountRaised: one grouped aggregate (VaultExpense.groupBy)
   * rather than N+1 per-milestone queries, and per-currency rather than
   * summed, since a milestone's expenses aren't currency-locked the way
   * its own targetAmount is (that stays in the vault's primary currency
   * only — see Vault.additionalCurrencies's own schema comment — but
   * VaultExpensesService.create() validates against the vault's full
   * accepted-currency set, so a milestone could in principle have spend
   * in more than one).
   */
  private async withActualSpend<T extends { id: string }>(
    milestones: T[],
  ): Promise<(T & { actualSpend: { currency: string; amount: string }[] })[]> {
    if (milestones.length === 0) return [];
    const sums = await prisma.vaultExpense.groupBy({
      by: ["vaultMilestoneId", "currency"],
      where: { vaultMilestoneId: { in: milestones.map((m) => m.id) } },
      _sum: { amount: true },
    });
    const spendByMilestoneId = new Map<string, { currency: string; amount: string }[]>();
    for (const s of sums) {
      if (!s.vaultMilestoneId) continue;
      const list = spendByMilestoneId.get(s.vaultMilestoneId) ?? [];
      list.push({ currency: s.currency, amount: s._sum.amount?.toString() ?? "0" });
      spendByMilestoneId.set(s.vaultMilestoneId, list);
    }
    return milestones.map((m) => ({ ...m, actualSpend: spendByMilestoneId.get(m.id) ?? [] }));
  }

  findById(id: string) {
    return prisma.vaultMilestone.findFirst({ where: { id, deletedAt: null } });
  }

  /**
   * Plain staff CRUD, same trust tier as create() — marking work as
   * started moves no money, so unlike complete() this needs no
   * governed_actions checkpoint. Found in a codebase audit: the
   * VaultMilestoneStatus enum has always had this value, but nothing
   * ever wrote it — pending went straight to completed with no way to
   * show a milestone is actually underway, on both the Ops Console and
   * the public donor-facing progress timeline.
   */
  async markInProgress(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const milestone = await tx.vaultMilestone.findFirst({ where: { id, deletedAt: null } });
      if (!milestone) throw new NotFoundException(`Milestone "${id}" not found.`);
      if (milestone.status !== "pending") {
        throw new BadRequestException(`Milestone "${milestone.name}" is ${milestone.status}, not pending.`);
      }
      const updated = await tx.vaultMilestone.update({ where: { id }, data: { status: "in_progress" } });
      await tx.auditLog.create({
        data: {
          vaultId: milestone.vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: "vault_milestone.started",
          entityType: "VaultMilestone",
          entityId: id,
          before: milestone as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  /**
   * Plain staff CRUD, same trust tier as create()/markInProgress() —
   * evidence-gathering is supporting material for a checker's own
   * judgment call on vault.milestone_complete, not itself a decision
   * that moves money, so it doesn't need a second governed checkpoint
   * on top of the one that already exists. Callable at any status,
   * including after completion (e.g. a final report uploaded once
   * it's ready) — each change is still audit-logged with a real
   * before/after, so a later swap is traceable even though it isn't
   * gated.
   */
  async setEvidence(id: string, input: { evidenceNotes?: string; evidenceFileUrl?: string }, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const milestone = await tx.vaultMilestone.findFirst({ where: { id, deletedAt: null } });
      if (!milestone) throw new NotFoundException(`Milestone "${id}" not found.`);

      const updated = await tx.vaultMilestone.update({
        where: { id },
        data: {
          evidenceNotes: input.evidenceNotes ?? milestone.evidenceNotes,
          evidenceFileUrl: input.evidenceFileUrl ?? milestone.evidenceFileUrl,
        },
      });
      await tx.auditLog.create({
        data: {
          vaultId: milestone.vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: "vault_milestone.evidence_updated",
          entityType: "VaultMilestone",
          entityId: id,
          before: milestone as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  /**
   * Internal only — never exposed behind a public controller route.
   * vault.milestone_complete is a governed action; the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction. Mirrors VaultsService.publish()'s own shape: a plain
   * internal state-transition method a governed handler's onApprove
   * calls, not something a staff member can trigger directly.
   */
  async complete(id: string, tx: Prisma.TransactionClient) {
    const milestone = await tx.vaultMilestone.findUnique({ where: { id } });
    if (!milestone) throw new NotFoundException(`Milestone "${id}" not found.`);
    if (milestone.status === "completed") {
      throw new BadRequestException(`Milestone "${milestone.name}" is already completed.`);
    }
    return tx.vaultMilestone.update({ where: { id }, data: { status: "completed", completedAt: new Date() } });
  }
}

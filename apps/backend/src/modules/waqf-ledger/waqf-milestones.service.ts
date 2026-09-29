import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsInt, IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export class UpdateWaqfMilestoneEvidenceInput {
  @IsOptional()
  @IsString()
  evidenceNotes?: string;
}

export class CreateWaqfMilestoneInput {
  @IsString()
  waqfId!: string;

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
 * Founder/Waqf-side counterpart to VaultMilestonesService — Project-type
 * Waqf Fund lifecycle tracking (2026-09-15). Investment/Asset-type funds
 * have no construction-progress concept, so create() rejects against
 * anything but a "project" waqf, same type-branching precedent
 * assertWithinAllocation already uses elsewhere. Plain staff CRUD to
 * create/list — the real fiduciary checkpoint is completing a milestone
 * (waqf.milestone_complete, a governed action), not creating the
 * tracking row itself.
 */
@Injectable()
export class WaqfMilestonesService {
  async create(input: CreateWaqfMilestoneInput, actorUserId: string) {
    const waqf = await prisma.waqf.findFirst({ where: { id: input.waqfId, deletedAt: null } });
    if (!waqf) throw new NotFoundException(`Waqf "${input.waqfId}" not found.`);
    if (waqf.type !== "project") {
      throw new BadRequestException(`Milestones only apply to project-type waqf funds — "${waqf.name}" is ${waqf.type}.`);
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const milestone = await tx.waqfMilestone.create({ data: input });
        await tx.auditLog.create({
          data: {
            waqfId: input.waqfId,
            actorType: "birr_staff",
            actorUserId,
            action: "waqf_milestone.created",
            entityType: "WaqfMilestone",
            entityId: milestone.id,
            after: milestone as any,
          },
        });
        return milestone;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException(`This waqf already has a milestone at sequence ${input.sequence}.`);
      }
      throw err;
    }
  }

  async list(waqfId: string) {
    const milestones = await prisma.waqfMilestone.findMany({ where: { waqfId, deletedAt: null }, orderBy: { sequence: "asc" } });
    return this.withActualSpend(milestones);
  }

  /**
   * Founder Portal's own read-only "Project progress" section — full
   * shape (name/status/evidence/targetAmount/actualSpend), unlike
   * Vault's anonymous public donor page, which excludes budget figures
   * entirely (see PUBLIC_VAULT_SELECT's own comment). A Founder isn't
   * an anonymous donor — they established this fund and already see
   * amountRaised/corpusAmount elsewhere on this same page, so there's
   * no reason to hide what their own money was budgeted or spent
   * against. Returns null when the waqf isn't found or isn't theirs,
   * matching AssetsService.listForFounder's own convention — the
   * controller turns that into a 404.
   */
  async listForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) return null;
      const milestones = await tx.waqfMilestone.findMany({ where: { waqfId, deletedAt: null }, orderBy: { sequence: "asc" } });
      return this.withActualSpend(milestones);
    });
  }

  /**
   * Batches "how much has actually been spent against this milestone"
   * onto each row — same shape/reasoning as
   * VaultMilestonesService.withActualSpend: one grouped aggregate
   * (WaqfExpense.groupBy) rather than N+1 per-milestone queries.
   */
  private async withActualSpend<T extends { id: string }>(
    milestones: T[],
  ): Promise<(T & { actualSpend: { currency: string; amount: string }[] })[]> {
    if (milestones.length === 0) return [];
    const sums = await prisma.waqfExpense.groupBy({
      by: ["waqfMilestoneId", "currency"],
      where: { waqfMilestoneId: { in: milestones.map((m) => m.id) } },
      _sum: { amount: true },
    });
    const spendByMilestoneId = new Map<string, { currency: string; amount: string }[]>();
    for (const s of sums) {
      if (!s.waqfMilestoneId) continue;
      const list = spendByMilestoneId.get(s.waqfMilestoneId) ?? [];
      list.push({ currency: s.currency, amount: s._sum.amount?.toString() ?? "0" });
      spendByMilestoneId.set(s.waqfMilestoneId, list);
    }
    return milestones.map((m) => ({ ...m, actualSpend: spendByMilestoneId.get(m.id) ?? [] }));
  }

  findById(id: string) {
    return prisma.waqfMilestone.findFirst({ where: { id, deletedAt: null } });
  }

  /**
   * Plain staff CRUD, same trust tier as create() — marking work as
   * started moves no money, so unlike complete() this needs no
   * governed_actions checkpoint. Mirrors VaultMilestonesService
   * .markInProgress() exactly.
   */
  async markInProgress(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const milestone = await tx.waqfMilestone.findFirst({ where: { id, deletedAt: null } });
      if (!milestone) throw new NotFoundException(`Milestone "${id}" not found.`);
      if (milestone.status !== "pending") {
        throw new BadRequestException(`Milestone "${milestone.name}" is ${milestone.status}, not pending.`);
      }
      const updated = await tx.waqfMilestone.update({ where: { id }, data: { status: "in_progress" } });
      await tx.auditLog.create({
        data: {
          waqfId: milestone.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_milestone.started",
          entityType: "WaqfMilestone",
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
   * judgment call on waqf.milestone_complete, not itself a decision
   * that moves money. Callable at any status, including after
   * completion. Mirrors VaultMilestonesService.setEvidence() exactly.
   */
  async setEvidence(id: string, input: { evidenceNotes?: string; evidenceFileUrl?: string }, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const milestone = await tx.waqfMilestone.findFirst({ where: { id, deletedAt: null } });
      if (!milestone) throw new NotFoundException(`Milestone "${id}" not found.`);

      const updated = await tx.waqfMilestone.update({
        where: { id },
        data: {
          evidenceNotes: input.evidenceNotes ?? milestone.evidenceNotes,
          evidenceFileUrl: input.evidenceFileUrl ?? milestone.evidenceFileUrl,
        },
      });
      await tx.auditLog.create({
        data: {
          waqfId: milestone.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_milestone.evidence_updated",
          entityType: "WaqfMilestone",
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
   * waqf.milestone_complete is a governed action; the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction. Mirrors VaultMilestonesService.complete() exactly.
   */
  async complete(id: string, tx: Prisma.TransactionClient) {
    const milestone = await tx.waqfMilestone.findUnique({ where: { id } });
    if (!milestone) throw new NotFoundException(`Milestone "${id}" not found.`);
    if (milestone.status === "completed") {
      throw new BadRequestException(`Milestone "${milestone.name}" is already completed.`);
    }
    return tx.waqfMilestone.update({ where: { id }, data: { status: "completed", completedAt: new Date() } });
  }
}

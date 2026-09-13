import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsInt, IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

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
    const vault = await prisma.vault.findFirst({ where: { id: input.vaultId, deletedAt: null } });
    if (!vault) throw new NotFoundException(`Vault "${input.vaultId}" not found.`);
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

  list(vaultId: string) {
    return prisma.vaultMilestone.findMany({ where: { vaultId, deletedAt: null }, orderBy: { sequence: "asc" } });
  }

  findById(id: string) {
    return prisma.vaultMilestone.findFirst({ where: { id, deletedAt: null } });
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

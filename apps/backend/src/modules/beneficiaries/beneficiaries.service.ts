import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";

export class CreateBeneficiaryInput {
  @IsString()
  waqfId!: string;

  @IsOptional()
  @IsString()
  causeId?: string;

  @IsString()
  name!: string;

  @IsString()
  eligibilityCriteria!: string;
}

@Injectable()
export class BeneficiariesService {
  /**
   * causeId is optional — a beneficiary can qualify under the fund
   * generally without being pinned to one specific cause up front. When
   * given, it must belong to the same waqf as the beneficiary itself —
   * Postgres can't express that as a composite FK here, so it's checked
   * in application code instead (mirrors DistributionsService.create()'s
   * identical check).
   *
   * Not maker-checker gated (only beneficiary.criteria_update is), but
   * still a create on a governed entity per CLAUDE.md's audit-trail
   * non-negotiable — wrapped in a transaction so the create and its
   * audit row are atomic.
   */
  async create(input: CreateBeneficiaryInput, actorUserId: string) {
    if (input.causeId) {
      const cause = await prisma.waqfCause.findUnique({ where: { id: input.causeId } });
      if (!cause || cause.waqfId !== input.waqfId) {
        throw new BadRequestException(
          `Cause "${input.causeId}" does not belong to waqf "${input.waqfId}".`,
        );
      }
    }
    return prisma.$transaction(async (tx) => {
      const beneficiary = await tx.beneficiary.create({ data: input });
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "beneficiary.created",
          entityType: "Beneficiary",
          entityId: beneficiary.id,
          after: beneficiary as any,
        },
      });
      return beneficiary;
    });
  }

  /**
   * Internal only — never expose this behind a public controller route.
   * beneficiary.criteria_update is a governed action (see schema.prisma's
   * comment on Beneficiary); the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction.
   */
  async updateCriteria(id: string, newCriteria: string, tx: Prisma.TransactionClient) {
    const beneficiary = await tx.beneficiary.findUnique({ where: { id } });
    if (!beneficiary) throw new NotFoundException(`Beneficiary "${id}" not found.`);
    return tx.beneficiary.update({
      where: { id },
      data: { eligibilityCriteria: newCriteria },
    });
  }

  findById(id: string) {
    return prisma.beneficiary.findUnique({ where: { id } });
  }

  list(waqfId?: string) {
    return prisma.beneficiary.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }
}

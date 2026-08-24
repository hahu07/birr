import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsNumberString, IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";

export class CreateDistributionInput {
  @IsString()
  waqfId!: string;

  @IsString()
  causeId!: string;

  @IsString()
  beneficiaryId!: string;

  // See AssetsService's CreateAssetInput.estimatedValue for why this is
  // @IsNumberString rather than @IsNumber.
  @IsNumberString()
  amount!: Prisma.Decimal | number | string;
}

@Injectable()
export class DistributionsService {
  /**
   * causeId is required — every payout must be traceable to a specific
   * cause, not just to the fund (CLAUDE.md-adjacent restructuring: see
   * the Founder -> Foundation -> Waqf Fund -> Cause plan). Nothing at
   * the schema level stops posting a causeId that belongs to a
   * *different* waqf than the one specified (Postgres can't express
   * "this cause belongs to this waqf" as a composite FK here), so that's
   * checked here instead.
   */
  // Not maker-checker gated (only distribution.approve is), but still a
  // create on a governed entity per CLAUDE.md's audit-trail
  // non-negotiable — wrapped in a transaction so the create and its
  // audit row are atomic.
  async create(input: CreateDistributionInput, actorUserId: string) {
    const cause = await prisma.waqfCause.findUnique({ where: { id: input.causeId } });
    if (!cause || cause.waqfId !== input.waqfId) {
      throw new BadRequestException(
        `Cause "${input.causeId}" does not belong to waqf "${input.waqfId}".`,
      );
    }
    return prisma.$transaction(async (tx) => {
      const distribution = await tx.distribution.create({ data: input });
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "distribution.created",
          entityType: "Distribution",
          entityId: distribution.id,
          after: distribution as any,
        },
      });
      return distribution;
    });
  }

  /**
   * Internal only — never expose this behind a public controller route.
   * distribution.approve is a governed action (see schema.prisma's
   * comment on Distribution); the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction. On a governed-action *rejection*, no fulfillment runs
   * at all (the handler map is only invoked when the checker approves —
   * same as every other entity), so a rejected distribution simply stays
   * at `pending`.
   */
  async approve(id: string, tx: Prisma.TransactionClient) {
    const distribution = await tx.distribution.findUnique({ where: { id } });
    if (!distribution) throw new NotFoundException(`Distribution "${id}" not found.`);
    return tx.distribution.update({
      where: { id },
      data: { status: "approved", approvedAt: new Date() },
    });
  }

  findById(id: string) {
    return prisma.distribution.findUnique({ where: { id } });
  }

  list(waqfId?: string) {
    return prisma.distribution.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }
}

import { Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString, IsString } from "class-validator";
import { prisma, Prisma, InvestmentInstrumentType } from "@birr/db";

export class CreateInvestmentInput {
  @IsString()
  waqfId!: string;

  @IsString()
  name!: string;

  @IsEnum(InvestmentInstrumentType)
  instrumentType!: InvestmentInstrumentType;

  // See AssetsService's CreateAssetInput.estimatedValue for why this is
  // @IsNumberString rather than @IsNumber.
  @IsNumberString()
  allocatedAmount!: Prisma.Decimal | number | string;
}

@Injectable()
export class InvestmentsService {
  // Not maker-checker gated (only investment.change is), but still a
  // create on a governed entity per CLAUDE.md's audit-trail
  // non-negotiable — wrapped in a transaction so the create and its
  // audit row are atomic.
  create(input: CreateInvestmentInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const investment = await tx.investment.create({ data: input });
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "investment.created",
          entityType: "Investment",
          entityId: investment.id,
          after: investment as any,
        },
      });
      return investment;
    });
  }

  /**
   * Internal only — never expose this behind a public controller route.
   * investment.change is a governed action (see schema.prisma's comment
   * on Investment); the only caller is GovernedActionsService's handler
   * map, on approval, inside its own transaction.
   */
  async changeAllocation(
    id: string,
    newAllocatedAmount: Prisma.Decimal | number | string,
    tx: Prisma.TransactionClient,
  ) {
    const investment = await tx.investment.findUnique({ where: { id } });
    if (!investment) throw new NotFoundException(`Investment "${id}" not found.`);
    return tx.investment.update({
      where: { id },
      data: { allocatedAmount: newAllocatedAmount },
    });
  }

  findById(id: string) {
    return prisma.investment.findUnique({ where: { id } });
  }

  list(waqfId?: string) {
    return prisma.investment.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }
}

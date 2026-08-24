import { Injectable } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { prisma } from "@birr/db";

export class CreateWaqfCauseInput {
  @IsString()
  waqfId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

@Injectable()
export class WaqfCausesService {
  /**
   * Plain CRUD, not a governed_actions action — a Cause is a
   * theme/purpose within one Waqf Fund's deed (e.g. an Education Fund's
   * "Teacher Training"), not a separate legal endowment, so it carries
   * none of waqf.create's maker-checker weight. Still audited (unlike
   * the pre-existing gap found in Asset/Beneficiary/Investment/
   * Distribution registration — see the plan this was built from) since
   * CLAUDE.md's audit non-negotiable is about every governed-adjacent
   * write, not just maker-checker ones.
   */
  async create(input: CreateWaqfCauseInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const cause = await tx.waqfCause.create({ data: input });
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_cause.created",
          entityType: "WaqfCause",
          entityId: cause.id,
          after: cause as any,
        },
      });
      return cause;
    });
  }

  findById(id: string) {
    return prisma.waqfCause.findUnique({ where: { id } });
  }

  list(waqfId: string) {
    return prisma.waqfCause.findMany({
      where: { waqfId },
      orderBy: { createdAt: "desc" },
    });
  }
}

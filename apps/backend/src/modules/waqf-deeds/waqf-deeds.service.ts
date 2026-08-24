import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { prisma } from "@birr/db";
import { assertFounderVerified } from "../../common/auth/current-founder";
import { DEED_TEMPLATE_VERSION, renderDeedText } from "./deed-template";

export interface SignWaqfDeedInput {
  waqfId: string;
  founderId: string;
  typedLegalName: string;
  affirmed: boolean;
  ipAddress?: string;
}

@Injectable()
export class WaqfDeedsService {
  /**
   * Step 4, the final onboarding step — the founder's real, structured
   * e-signature appointing Birr as Mutawalli over this specific Waqf
   * Fund. Every prerequisite is re-derived here independently, not
   * trusted from the frontend or from FoundersService.getOnboardingStatus():
   * step 1 (assertFounderVerified), step 2 (ownership, which implies a
   * Foundation exists), and step 3 (waqf.status === "active", the same
   * signal ContributionsService.handleWebhook() already uses — reusing
   * that state machine rather than inventing a parallel one).
   */
  async sign(input: SignWaqfDeedInput) {
    await assertFounderVerified(prisma, input.founderId);

    const waqf = await prisma.waqf.findFirst({
      where: { id: input.waqfId, foundation: { foundationFounders: { some: { founderId: input.founderId } } } },
      include: { foundation: true, waqfDeed: true },
    });
    if (!waqf) {
      throw new ForbiddenException("This waqf fund doesn't belong to you.");
    }
    if (waqf.status !== "active") {
      throw new BadRequestException("Complete your first contribution before signing the deed.");
    }
    if (waqf.waqfDeed) {
      throw new ConflictException("This waqf fund's deed has already been signed.");
    }
    if (!input.affirmed) {
      throw new BadRequestException("You must affirm the declaration to sign.");
    }

    const membership = await prisma.founderMembership.findFirst({
      where: { founderId: input.founderId, permissionLevel: "primary_contact" },
      include: { user: true },
    });
    if (!membership) {
      throw new ForbiddenException("No primary contact found for this founder.");
    }
    if (input.typedLegalName.trim().toLowerCase() !== membership.user.fullName.trim().toLowerCase()) {
      throw new BadRequestException("The typed name must match your account's registered full name.");
    }

    const founder = await prisma.founder.findUniqueOrThrow({ where: { id: input.founderId } });

    return prisma.$transaction(async (tx) => {
      const deed = await tx.waqfDeed.create({
        data: {
          waqfId: waqf.id,
          signedByUserId: membership.user.id,
          signedByFounderId: input.founderId,
          typedLegalName: input.typedLegalName,
          deedTemplateVersion: DEED_TEMPLATE_VERSION,
          deedText: renderDeedText(waqf, waqf.foundation, founder),
          affirmed: true,
          ipAddress: input.ipAddress,
        },
      });

      await tx.auditLog.create({
        data: {
          waqfId: waqf.id,
          actorType: "founder_user",
          actorUserId: membership.user.id,
          actorFounderId: input.founderId,
          action: "waqf_deed.signed",
          entityType: "WaqfDeed",
          entityId: deed.id,
          after: deed as any,
          ipAddress: input.ipAddress,
        },
      });

      return deed;
    });
  }

  findByWaqfId(waqfId: string) {
    return prisma.waqfDeed.findUnique({ where: { waqfId } });
  }
}

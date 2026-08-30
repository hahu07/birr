import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { prisma } from "@birr/db";
import { assertFounderVerified } from "../../common/auth/current-founder";
import { withFounderScope } from "../../common/db/founder-scope";
import { FOUNDATION_DEED_TEMPLATE_VERSION, renderFoundationDeedText } from "./foundation-deed-template";
import { NotificationsService } from "../notifications/notifications.service";

export interface SignFoundationDeedInput {
  foundationId: string;
  founderId: string;
  typedLegalName: string;
  affirmed: boolean;
  ipAddress?: string;
}

@Injectable()
export class FoundationDeedsService {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Step 4, the final onboarding step — the founder's real, structured
   * e-signature appointing Birr as Mutawalli over this Foundation and
   * every Waqf Fund established under it, now or in the future. One
   * deed per Foundation, not per Waqf Fund — see this model's own
   * schema comment for why. Every prerequisite is re-derived here
   * independently, not trusted from the frontend or from
   * FoundersService.getOnboardingStatus(): step 1
   * (assertFounderVerified), step 2 (ownership, which implies the
   * Foundation exists), and step 3 (at least one Waqf Fund under the
   * Foundation is active — the same signal ContributionsService's
   * webhook handler already uses, just checked across every Waqf Fund
   * under the Foundation rather than one specific one).
   */
  async sign(input: SignFoundationDeedInput) {
    await assertFounderVerified(prisma, input.founderId);

    const foundation = await prisma.foundation.findFirst({
      where: { id: input.foundationId, foundationFounders: { some: { founderId: input.founderId } } },
      include: { foundationDeed: true, waqfs: true },
    });
    if (!foundation) {
      throw new ForbiddenException("This foundation doesn't belong to you.");
    }
    const activeWaqfs = foundation.waqfs.filter((w) => w.status === "active");
    if (activeWaqfs.length === 0) {
      throw new BadRequestException("Fund and confirm your first waqf contribution before signing the deed.");
    }
    if (foundation.foundationDeed) {
      throw new ConflictException("This foundation's deed has already been signed.");
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

    const deed = await prisma.$transaction(async (tx) => {
      const deed = await tx.foundationDeed.create({
        data: {
          foundationId: foundation.id,
          signedByUserId: membership.user.id,
          signedByFounderId: input.founderId,
          typedLegalName: input.typedLegalName,
          deedTemplateVersion: FOUNDATION_DEED_TEMPLATE_VERSION,
          deedText: renderFoundationDeedText(foundation, founder, activeWaqfs),
          affirmed: true,
          ipAddress: input.ipAddress,
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: "founder_user",
          actorUserId: membership.user.id,
          actorFounderId: input.founderId,
          action: "foundation_deed.signed",
          entityType: "FoundationDeed",
          entityId: deed.id,
          after: deed as any,
          ipAddress: input.ipAddress,
        },
      });

      return deed;
    });

    // A signing receipt to the signer, like any e-signature flow — the
    // durable record the "High" priority tier calls for, not a
    // team-wide broadcast (this is the signer's own action, not news to
    // react to). Deliberately not awaited — see the established
    // fire-and-forget posture for post-transaction notify() calls.
    this.notificationsService
      .notify({
        recipientType: "founder_user",
        recipientUserId: membership.user.id,
        type: "foundation_deed.signed",
        title: `Deed signed — ${foundation.name}`,
        body: `You signed the waqf deed appointing Birr as Mutawalli over ${foundation.name}.`,
        linkUrl: `/foundations/${foundation.id}/deed`,
        relatedEntityType: "FoundationDeed",
        relatedEntityId: deed.id,
      })
      .catch((err) => {
        console.error(`Failed to notify signer of deed "${deed.id}":`, err);
      });

    return deed;
  }

  // Staff-side / internal — unrestricted. Never expose this behind a
  // controller route reachable by a Founder session; see
  // findByFoundationIdForFounder below for that path.
  findByFoundationId(foundationId: string) {
    return prisma.foundationDeed.findUnique({ where: { foundationId } });
  }

  // Founder-Portal read-only visibility into their own Foundation's
  // signed deed — the actual legal instrument appointing Birr as
  // trustee, so ownership must be verified before returning it, same as
  // every other founder-scoped read in this codebase. Returns null (not
  // an empty object) when the foundation isn't found, isn't theirs, or
  // has no deed yet — the controller turns that into a 404.
  async findByFoundationIdForFounder(foundationId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const foundation = await tx.foundation.findFirst({
        where: { id: foundationId, foundationFounders: { some: { founderId } } },
        select: { id: true },
      });
      if (!foundation) return null;
      return tx.foundationDeed.findUnique({ where: { foundationId } });
    });
  }
}

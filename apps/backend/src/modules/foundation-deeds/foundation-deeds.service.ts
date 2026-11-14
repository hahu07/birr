import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { prisma } from "@birr/db";
import { assertFounderVerified } from "../../common/auth/current-founder";
import { withFounderScope } from "../../common/db/founder-scope";
import { foundationDeedTemplateVersion, renderFoundationDeedText } from "./foundation-deed-template";
import { NotificationsService } from "../notifications/notifications.service";
import { FunnelEventsService } from "../funnel-events/funnel-events.service";

export interface SignFoundationDeedInput {
  foundationId: string;
  founderId: string;
  typedLegalName: string;
  affirmed: boolean;
  /** textHash from the preview the signer was shown — see FoundationDeedsService.preview. */
  textHash: string;
  ipAddress?: string;
}

/** Who else agreed to the deed, and how — see CoFounderDeedConsent. Oldest first. */
async function coFounderConsentsFor(db: Pick<typeof prisma, "coFounderDeedConsent">, foundationId: string) {
  const rows = await db.coFounderDeedConsent.findMany({
    where: { foundationId },
    orderBy: { consentedAt: "asc" },
    include: { founder: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    founderName: r.founder.name,
    kind: r.kind,
    statementText: r.statementText,
    statementVersion: r.statementVersion,
    consentedAt: r.consentedAt,
  }));
}

function hashDeedText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

@Injectable()
export class FoundationDeedsService {
  private readonly logger = new Logger(FoundationDeedsService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly funnelEvents: FunnelEventsService,
  ) {}

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

    const { foundation, activeWaqfs, deedText, templateVersion } = await this.render(input.foundationId, input.founderId);
    if (activeWaqfs.length === 0) {
      throw new BadRequestException("Fund and confirm your first waqf contribution before signing the deed.");
    }
    if (foundation.foundationDeed) {
      throw new ConflictException("This foundation's deed has already been signed.");
    }
    if (!input.affirmed) {
      throw new BadRequestException("You must affirm the declaration to sign.");
    }
    // The signer must have seen exactly the text being stored: a fund
    // activated or a co-founder joined after their preview changes it.
    if (input.textHash !== hashDeedText(deedText)) {
      throw new ConflictException("The deed changed since you opened it — review it again before signing.");
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

    const deed = await prisma.$transaction(async (tx) => {
      const deed = await tx.foundationDeed.create({
        data: {
          foundationId: foundation.id,
          signedByUserId: membership.user.id,
          signedByFounderId: input.founderId,
          typedLegalName: input.typedLegalName,
          deedTemplateVersion: templateVersion,
          deedText,
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

    // Best-effort, same fire-and-forget posture as the receipt
    // notification just below — record() never throws.
    void this.funnelEvents.record({
      funnel: "founder",
      step: "deed_signed",
      sessionId: input.founderId,
      founderId: input.founderId,
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
        this.logger.error(
          `Failed to notify signer of deed "${deed.id}":`,
          err instanceof Error ? err.stack : String(err),
        );
      });

    return deed;
  }

  /**
   * The deed exactly as sign() would store it for this founder right now
   * — shown in full before signing, with a hash the signature must echo
   * back. Any founder of the Foundation may look; only a primary contact
   * may sign (FoundationDeedsController).
   */
  async preview(foundationId: string, founderId: string) {
    const { deedText, templateVersion, joint, foundation } = await this.render(foundationId, founderId);
    return {
      deedText,
      templateVersion,
      textHash: hashDeedText(deedText),
      joint: Boolean(joint),
      coFounders: joint?.coFounders.map((c) => c.name) ?? [],
      alreadySigned: Boolean(foundation.foundationDeed),
    };
  }

  // The one place the deed's text is decided, for both preview() and
  // sign(). Joint when the Foundation was established jointly, or has
  // more than one founder by the time it's signed: every other founder
  // is then named as a co-founder the signer signs for.
  private async render(foundationId: string, founderId: string) {
    const foundation = await prisma.foundation.findFirst({
      where: { id: foundationId, foundationFounders: { some: { founderId } } },
      include: { foundationDeed: true, waqfs: true, foundationFounders: { include: { founder: true } } },
    });
    if (!foundation) {
      throw new ForbiddenException("This foundation doesn't belong to you.");
    }
    const founder = foundation.foundationFounders.find((ff) => ff.founderId === founderId)!.founder;
    const activeWaqfs = foundation.waqfs.filter((w) => w.status === "active");
    const coFounders = foundation.foundationFounders.filter((ff) => ff.founderId !== founderId).map((ff) => ff.founder);
    const joint = foundation.establishedJointly || coFounders.length > 0 ? { coFounders } : null;
    return {
      foundation,
      activeWaqfs,
      joint,
      deedText: renderFoundationDeedText(foundation, founder, activeWaqfs, joint),
      templateVersion: foundationDeedTemplateVersion(joint),
    };
  }

  // Staff-side / internal — unrestricted. Never expose this behind a
  // controller route reachable by a Founder session; see
  // findByFoundationIdForFounder below for that path.
  async findByFoundationId(foundationId: string) {
    const deed = await prisma.foundationDeed.findUnique({ where: { foundationId } });
    return deed && { ...deed, coFounderConsents: await coFounderConsentsFor(prisma, foundationId) };
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
      const deed = await tx.foundationDeed.findUnique({ where: { foundationId } });
      return deed && { ...deed, coFounderConsents: await coFounderConsentsFor(tx, foundationId) };
    });
  }
}

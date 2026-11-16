import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { prisma, Prisma } from "@birr/db";
import {
  CO_FOUNDER_STATEMENT_VERSION,
  coFounderStatementContext,
  coFounderStatementKind,
  FOUNDATION_FOR_STATEMENT,
  hashStatement,
  lockFoundation,
  renderCoFounderStatement,
} from "./co-founder-consent";
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
    if (!input.affirmed) {
      throw new BadRequestException("You must affirm the declaration to sign.");
    }

    const membership = await prisma.founderMembership.findFirst({
      where: { founderId: input.founderId, permissionLevel: "primary_contact", status: "active" },
      include: { user: true },
    });
    if (!membership) {
      throw new ForbiddenException("No primary contact found for this founder.");
    }
    if (input.typedLegalName.trim().toLowerCase() !== membership.user.fullName.trim().toLowerCase()) {
      throw new BadRequestException("The typed name must match your account's registered full name.");
    }

    const { deed, foundation } = await prisma.$transaction(async (tx) => {
      // Everything the deed depends on is checked under the Foundation's
      // lock, so no co-founder joins (or agrees) between these checks and
      // the deed being stored.
      await lockFoundation(tx, input.foundationId);
      const { foundation, activeWaqfs, deedText, templateVersion, awaitingConsent } = await this.render(tx, input.foundationId, input.founderId);
      if (activeWaqfs.length === 0) {
        throw new BadRequestException("Fund and confirm your first waqf contribution before signing the deed.");
      }
      if (foundation.foundationDeed) {
        throw new ConflictException({ message: "This foundation's deed has already been signed.", code: "deed_already_signed" });
      }
      // A joint deed is signed for every co-founder, so each must first
      // have agreed to that in their own name (owner's decision,
      // 2026-11-16: wait for their consent rather than leave them out).
      if (awaitingConsent.length > 0) {
        throw new ConflictException({
          message: `Waiting for ${awaitingConsent.map((c) => c.name).join(", ")} to agree before the deed can be signed for them.`,
          code: "deed_awaiting_consent",
        });
      }
      // The signer must have seen exactly the text being stored: a fund
      // activated or a co-founder joined after their preview changes it.
      if (input.textHash !== hashDeedText(deedText)) {
        throw new ConflictException({ message: "The deed changed since you opened it — review it again before signing.", code: "deed_changed" });
      }

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

      return { deed, foundation };
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
    const { deedText, templateVersion, joint, foundation, awaitingConsent } = await this.render(prisma, foundationId, founderId);
    return {
      deedText,
      templateVersion,
      textHash: hashDeedText(deedText),
      joint: Boolean(joint),
      coFounders: joint?.coFounders.map((c) => c.name) ?? [],
      // Who must agree before this founder can sign for them.
      awaitingConsent: awaitingConsent.map((c) => c.name),
      alreadySigned: Boolean(foundation.foundationDeed),
    };
  }

  /**
   * This founder's own agreement to the deed, for a co-founder with none
   * on record (one who joined before agreeing was part of joining, or was
   * added another way). Null when nothing is needed: they've agreed, the
   * Foundation has no other founder, or they're the one who signed.
   */
  async consentStatus(foundationId: string, founderId: string) {
    const foundation = await prisma.foundation.findFirst({
      where: { id: foundationId, foundationFounders: { some: { founderId } } },
      select: {
        ...FOUNDATION_FOR_STATEMENT.select,
        foundationDeed: { select: { ...FOUNDATION_FOR_STATEMENT.select.foundationDeed.select, signedByFounderId: true } },
        _count: { select: { foundationFounders: true } },
      },
    });
    if (!foundation) throw new ForbiddenException("This foundation doesn't belong to you.");
    const existing = await prisma.coFounderDeedConsent.findUnique({ where: { foundationId_founderId: { foundationId, founderId } } });
    if (existing || foundation._count.foundationFounders < 2 || foundation.foundationDeed?.signedByFounderId === founderId) return null;
    const ctx = coFounderStatementContext(foundation);
    const text = renderCoFounderStatement(ctx);
    return { kind: coFounderStatementKind(ctx), text, version: CO_FOUNDER_STATEMENT_VERSION, hash: hashStatement(text) };
  }

  /** Records consentStatus()'s statement as agreed, by this founder's primary contact. */
  async giveConsent(input: { foundationId: string; founderId: string; userId: string; statementHash: string; ipAddress?: string }) {
    return prisma.$transaction(async (tx) => {
      await lockFoundation(tx, input.foundationId);
      const foundation = await tx.foundation.findFirst({
        where: { id: input.foundationId, foundationFounders: { some: { founderId: input.founderId } } },
        select: { ...FOUNDATION_FOR_STATEMENT.select, foundationDeed: { select: { ...FOUNDATION_FOR_STATEMENT.select.foundationDeed.select, signedByFounderId: true } } },
      });
      if (!foundation) throw new ForbiddenException("This foundation doesn't belong to you.");
      if (foundation.foundationDeed?.signedByFounderId === input.founderId) {
        throw new BadRequestException("You signed this deed yourself; there's nothing more to agree to.");
      }
      const ctx = coFounderStatementContext(foundation);
      const statementText = renderCoFounderStatement(ctx);
      if (hashStatement(statementText) !== input.statementHash) {
        throw new ConflictException({ message: "The deed changed while you were reading (it may have just been signed). Review the updated statement.", code: "statement_changed" });
      }
      let consent;
      try {
        consent = await tx.coFounderDeedConsent.create({
          data: {
            foundationId: input.foundationId,
            founderId: input.founderId,
            userId: input.userId,
            kind: coFounderStatementKind(ctx),
            foundationDeedId: foundation.foundationDeed?.id ?? null,
            statementVersion: CO_FOUNDER_STATEMENT_VERSION,
            statementText,
            ipAddress: input.ipAddress,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ConflictException("You've already agreed to this deed.");
        throw err;
      }
      await tx.auditLog.create({
        data: {
          actorType: "founder_user",
          actorUserId: input.userId,
          actorFounderId: input.founderId,
          action: "co_founder.deed_consented",
          entityType: "CoFounderDeedConsent",
          entityId: consent.id,
          after: consent as unknown as Prisma.InputJsonValue,
          ipAddress: input.ipAddress,
        },
      });
      return consent;
    });
  }

  // The one place the deed's text is decided, for both preview() and
  // sign(). Joint when the Foundation was established jointly, or has
  // more than one founder by the time it's signed: every other founder
  // is then named as a co-founder the signer signs for.
  //
  // Funds and co-founders are always listed in the same order (oldest
  // first, then by id): the text is hashed, and must come out identical
  // in preview() and sign() however Postgres happens to return the rows.
  private async render(db: Prisma.TransactionClient | typeof prisma, foundationId: string, founderId: string) {
    const foundation = await db.foundation.findFirst({
      where: { id: foundationId, foundationFounders: { some: { founderId } } },
      include: {
        foundationDeed: true,
        waqfs: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        foundationFounders: { include: { founder: true }, orderBy: [{ founder: { createdAt: "asc" } }, { founderId: "asc" }] },
      },
    });
    if (!foundation) {
      throw new ForbiddenException("This foundation doesn't belong to you.");
    }
    const founder = foundation.foundationFounders.find((ff) => ff.founderId === founderId)!.founder;
    const activeWaqfs = foundation.waqfs.filter((w) => w.status === "active");
    const coFounders = foundation.foundationFounders.filter((ff) => ff.founderId !== founderId).map((ff) => ff.founder);
    const joint = foundation.establishedJointly || coFounders.length > 0 ? { coFounders } : null;
    const consented = new Set(
      (await db.coFounderDeedConsent.findMany({ where: { foundationId }, select: { founderId: true } })).map((c) => c.founderId),
    );
    return {
      foundation,
      activeWaqfs,
      joint,
      awaitingConsent: coFounders.filter((c) => !consented.has(c.id)),
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

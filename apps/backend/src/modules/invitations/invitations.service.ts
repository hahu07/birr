import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { prisma, InviteeKind, BirrStaffRole, FounderPermissionLevel, FounderKind, InstitutionType } from "@birr/db";
import { hashPassword } from "../../common/auth/password-auth";
import { ResendInvitationEmailAdapter } from "./email/resend-invitation.adapter";
import { NotificationsService } from "../notifications/notifications.service";
import {
  resolveFounderTeammateUserIds,
  resolveFounderRecipientUserIdsForFoundation,
} from "../../common/notifications/resolve-founder-recipients";
import { withFounderScope } from "../../common/db/founder-scope";

const INVITATION_VALIDITY_DAYS = 7;
const MIN_PASSWORD_LENGTH = 8;

// Small and local rather than a shared package export — this is the
// only place on the backend that turns an enum key into display text;
// every frontend already has its own richer humanize() for UI use.
function humanizeRoleKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface InviteInput {
  inviteeKind: InviteeKind;
  email: string;
  founderId?: string;
  // co_founder only — the EXISTING Foundation to attach the invitee's
  // brand-new Founder to once accepted.
  foundationId?: string;
  roleKey: string;
  invitedByUserId: string;
  // Who's actually sending this — a Birr staff member inviting another
  // staff member or a founder_user on a Founder's behalf, or a Founder's
  // own primary contact inviting a colleague. Drives the audit log's
  // actorType/actorFounderId instead of hardcoding "birr_staff" the way
  // this used to, back when only staff could ever call invite(). Optional
  // and defaults to "birr_staff" — every real controller call site sets
  // it explicitly; the default just keeps existing staff-invite tests
  // from all needing the same boilerplate field added.
  invitedByActorType?: "birr_staff" | "founder_user";
  invitedByFounderId?: string;
}

export class AcceptInput {
  @IsString()
  token!: string;

  @IsString()
  fullName!: string;

  @MinLength(MIN_PASSWORD_LENGTH)
  password!: string;

  // Only required when accepting a co_founder invitation — the new
  // Founder identity being established, same shape as
  // EstablishFounderAndFoundationInput's own fields. A single static
  // decorator can't express "required depending on inviteeKind," so
  // accept() itself does the real gating (same posture as roleKey's
  // dual meaning on InviteBody).
  @IsOptional()
  @IsString()
  founderName?: string;

  @IsOptional()
  @IsEnum(FounderKind)
  kind?: FounderKind;

  @IsOptional()
  @IsEnum(InstitutionType)
  institutionType?: InstitutionType;

  @IsOptional()
  @IsString()
  homeJurisdiction?: string;
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly emailAdapter: ResendInvitationEmailAdapter,
    private readonly notificationsService: NotificationsService,
  ) {}

  async invite(input: InviteInput) {
    if (input.inviteeKind === "founder_user") {
      if (!input.founderId) {
        throw new BadRequestException("founderId is required for a founder_user invitation.");
      }
      const founder = await prisma.founder.findUnique({ where: { id: input.founderId } });
      if (!founder) {
        throw new NotFoundException(`Founder "${input.founderId}" not found.`);
      }
      if (!Object.values(FounderPermissionLevel).includes(input.roleKey as any)) {
        throw new BadRequestException(`"${input.roleKey}" is not a valid FounderPermissionLevel.`);
      }
    } else if (input.inviteeKind === "co_founder") {
      if (input.founderId) {
        throw new BadRequestException("founderId must not be set for a co_founder invitation.");
      }
      if (!input.foundationId) {
        throw new BadRequestException("foundationId is required for a co_founder invitation.");
      }
      const foundation = await prisma.foundation.findUnique({ where: { id: input.foundationId } });
      if (!foundation) {
        throw new NotFoundException(`Foundation "${input.foundationId}" not found.`);
      }
      // roleKey has no meaning here — the invitee always joins as
      // primary_contact of their own brand-new Founder, not with a
      // chosen FounderPermissionLevel or BirrStaffRole.
    } else {
      if (input.founderId) {
        throw new BadRequestException("founderId must not be set for a birr_staff invitation.");
      }
      if (!Object.values(BirrStaffRole).includes(input.roleKey as any)) {
        throw new BadRequestException(`"${input.roleKey}" is not a valid BirrStaffRole.`);
      }
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await prisma.$transaction(async (tx) => {
      const created = await tx.invitation.create({
        data: {
          inviteeKind: input.inviteeKind,
          email: input.email,
          founderId: input.founderId,
          foundationId: input.foundationId,
          roleKey: input.roleKey,
          invitedBy: input.invitedByUserId,
          token,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: input.invitedByActorType ?? "birr_staff",
          actorUserId: input.invitedByUserId,
          actorFounderId: input.invitedByActorType === "founder_user" ? input.invitedByFounderId : undefined,
          action: "invitation.sent",
          entityType: "Invitation",
          entityId: created.id,
          after: created as any,
        },
      });

      return created;
    });

    // Best-effort, outside the transaction — a Resend outage or missing
    // config shouldn't roll back a real invitation record, and the
    // Ops/Founder Team pages both already have a copy-link fallback for
    // exactly this case. emailSent tells the caller whether to lean on
    // that fallback or not.
    let emailSent = false;
    try {
      const inviter = await prisma.user.findUnique({ where: { id: input.invitedByUserId } });
      const portalUrl = process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000";
      // co_founder invitations carry the invitee kind on the link itself
      // (?kind=co_founder) — the accept page only ever has the token to
      // go on, and this is cheaper than a new lookup-by-token endpoint.
      const acceptUrl =
        input.inviteeKind === "co_founder"
          ? `${portalUrl}/ops/accept-invitation?token=${token}&kind=co_founder`
          : `${portalUrl}/ops/accept-invitation?token=${token}`;
      await this.emailAdapter.sendInvitationEmail(input.email, acceptUrl, {
        inviteeKind: input.inviteeKind,
        roleLabel: input.inviteeKind === "co_founder" ? "a co-founder" : humanizeRoleKey(input.roleKey),
        invitedByName: inviter?.fullName ?? "A Birr team member",
      });
      emailSent = true;
    } catch (err) {
      this.logger.error(`Couldn't send invitation email to ${input.email}:`, err instanceof Error ? err.message : err);
    }

    // In-app confirmation to whoever just sent it — not the invitee
    // (they have no account yet; the email above is their actual
    // invitation) — see CHANNEL_PLAN: in-app only, no need to also email
    // someone about an action they just took themselves.
    this.notificationsService
      .notify({
        recipientType: input.invitedByActorType ?? "birr_staff",
        recipientUserId: input.invitedByUserId,
        type: "invitation.sent",
        title: "Invitation sent",
        body:
          input.inviteeKind === "co_founder"
            ? `You invited ${input.email} to co-found your Foundation.`
            : `You invited ${input.email} as ${humanizeRoleKey(input.roleKey)}.`,
        linkUrl:
          input.inviteeKind === "founder_user"
            ? "/team"
            : input.inviteeKind === "co_founder"
              ? `/foundations/${input.foundationId}`
              : "/ops/staff",
        relatedEntityType: "Invitation",
        relatedEntityId: invitation.id,
      })
      .catch((err) => {
        this.logger.error(
          `Failed to notify inviter for invitation "${invitation.id}":`,
          err instanceof Error ? err.stack : String(err),
        );
      });

    return { ...invitation, emailSent };
  }

  /**
   * Deliberately no auth check here — the token itself is the
   * credential. The whole point is onboarding someone who has no account
   * yet, so there's nothing to authenticate them against beforehand.
   */
  async accept(input: AcceptInput) {
    const invitation = await prisma.invitation.findUnique({
      where: { token: input.token },
    });
    if (!invitation) {
      throw new NotFoundException("Invitation not found.");
    }
    if (invitation.status !== "pending") {
      throw new BadRequestException(
        `Invitation has already been ${invitation.status}.`,
      );
    }
    if (invitation.expiresAt < new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "expired" },
      });
      throw new BadRequestException("Invitation has expired.");
    }
    // Also enforced by AcceptInput's own @MinLength decorator
    // (class-validator, global ValidationPipe) for any real HTTP
    // request — repeated here as defense-in-depth for direct callers,
    // same reasoning as FoundersService.signUp's identical check.
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (invitation.inviteeKind === "co_founder" && (!input.founderName?.trim() || !input.kind)) {
      throw new BadRequestException("founderName and kind are required to accept a co-founder invitation.");
    }
    // A stray User row can already exist for this email — e.g. an
    // abandoned self-service sign-up that never verified (status stays
    // "invited" indefinitely, see FoundersService.signUp), unrelated to
    // this specific invitation. Without this check, tx.user.create()
    // below fails on the email unique constraint and surfaces as an
    // opaque 500 instead of an actionable message. Deliberately not
    // auto-attaching this invitation's membership to that existing
    // identity — reusing an existing account's password/identity
    // implicitly from an invite-accept flow is a security-sensitive
    // merge decision, not something to do silently.
    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
    if (existingUser) {
      throw new ConflictException(
        `An account already exists for ${invitation.email}. Sign in with that account instead, or contact support if this looks wrong.`,
      );
    }

    const passwordHash = await hashPassword(input.password);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: invitation.email, fullName: input.fullName, passwordHash, status: "active" },
      });

      let membershipOrStaff: { id: string };
      let newFounderId: string | undefined;

      if (invitation.inviteeKind === "founder_user") {
        membershipOrStaff = await tx.founderMembership.create({
          data: {
            founderId: invitation.founderId!,
            userId: user.id,
            permissionLevel: invitation.roleKey as FounderPermissionLevel,
            invitedBy: invitation.invitedBy,
          },
        });
      } else if (invitation.inviteeKind === "co_founder") {
        // Mirrors FoundersService.establishFounderAndFoundation()'s own
        // Founder-create + primary_contact-membership-create + audit
        // shape exactly — just attaching to the EXISTING Foundation
        // named on the invitation instead of creating a new one.
        const founder = await tx.founder.create({
          data: {
            name: input.founderName!,
            kind: input.kind!,
            institutionType: input.institutionType,
            homeJurisdiction: input.homeJurisdiction,
          },
        });
        newFounderId = founder.id;
        membershipOrStaff = await tx.founderMembership.create({
          data: { founderId: founder.id, userId: user.id, permissionLevel: "primary_contact" },
        });
        await tx.foundationFounder.create({
          data: { foundationId: invitation.foundationId!, founderId: founder.id },
        });
        await tx.auditLog.create({
          data: {
            actorType: "founder_user",
            actorUserId: user.id,
            actorFounderId: founder.id,
            action: "founder.created",
            entityType: "Founder",
            entityId: founder.id,
            after: founder as any,
          },
        });
        await tx.auditLog.create({
          data: {
            actorType: "founder_user",
            actorUserId: user.id,
            actorFounderId: founder.id,
            action: "foundationFounder.created",
            entityType: "FoundationFounder",
            // Composite-key join, no synthetic id — encode both halves.
            entityId: `${invitation.foundationId}:${founder.id}`,
            after: { foundationId: invitation.foundationId, founderId: founder.id } as any,
          },
        });
      } else {
        membershipOrStaff = await tx.birrStaff.create({
          data: {
            userId: user.id,
            staffRole: invitation.roleKey as BirrStaffRole,
          },
        });
      }

      const accepted = await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "accepted" },
      });

      await tx.auditLog.create({
        data: {
          // co_founder acceptance is a founder_user acting for
          // themselves, same as founder_user invitations — ActorType
          // has no separate "co_founder" value.
          actorType: invitation.inviteeKind === "co_founder" ? "founder_user" : invitation.inviteeKind,
          actorUserId: user.id,
          actorFounderId: newFounderId,
          action: "invitation.accepted",
          entityType: "Invitation",
          entityId: invitation.id,
          after: accepted as any,
        },
      });

      // Strip passwordHash before it ever reaches a response body — same
      // principle as BirrStaffService's SAFE_USER_SELECT.
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return { user: safeUser, membershipOrStaff, invitation: accepted, newFounderId };
    });

    // Deliberately NOT awaited — same posture as every other
    // post-transaction notify() fan-out this session. Founder-team-
    // internal only — BirrStaff isn't grouped into teams the way
    // FounderMembership is, so a staff invite's acceptance has no
    // equivalent "colleague joined" audience.
    if (invitation.inviteeKind === "founder_user" && invitation.founderId) {
      this.notifyTeammatesOfNewMember(invitation.founderId, result.user.id, result.user.fullName, result.membershipOrStaff.id).catch(
        (err) => {
          this.logger.error(
            `Failed to notify teammates of new member "${result.user.id}":`,
            err instanceof Error ? err.stack : String(err),
          );
        },
      );
    } else if (invitation.inviteeKind === "co_founder" && invitation.foundationId && result.newFounderId) {
      this.notifyCoFoundersOfNewFounder(invitation.foundationId, result.newFounderId, input.founderName!).catch((err) => {
        this.logger.error(
          `Failed to notify co-founders of new founder "${result.newFounderId}":`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    }

    return result;
  }

  private async notifyTeammatesOfNewMember(
    founderId: string,
    newUserId: string,
    newUserFullName: string,
    membershipId: string,
  ): Promise<void> {
    const teammateUserIds = await resolveFounderTeammateUserIds(founderId, newUserId);
    await Promise.all(
      teammateUserIds.map((userId) =>
        this.notificationsService.notify({
          recipientType: "founder_user",
          recipientUserId: userId,
          type: "founder_membership.joined",
          title: "A colleague joined your team",
          body: `${newUserFullName} has joined your Founder team.`,
          linkUrl: "/team",
          relatedEntityType: "FounderMembership",
          relatedEntityId: membershipId,
        }),
      ),
    );
  }

  private async notifyCoFoundersOfNewFounder(
    foundationId: string,
    newFounderId: string,
    newFounderName: string,
  ): Promise<void> {
    const recipientUserIds = await resolveFounderRecipientUserIdsForFoundation(foundationId, newFounderId);
    await Promise.all(
      recipientUserIds.map((userId) =>
        this.notificationsService.notify({
          recipientType: "founder_user",
          recipientUserId: userId,
          type: "foundation.co_founder_joined",
          title: "A new co-founder joined your Foundation",
          body: `${newFounderName} has joined as a co-founder.`,
          linkUrl: `/foundations/${foundationId}`,
          relatedEntityType: "FoundationFounder",
          relatedEntityId: `${foundationId}:${newFounderId}`,
        }),
      ),
    );
  }

  async revoke(
    id: string,
    revokedByUserId: string,
    actor: { type: "birr_staff" | "founder_user"; founderId?: string } = { type: "birr_staff" },
  ) {
    const invitation = await prisma.invitation.findUnique({ where: { id } });
    if (!invitation) throw new NotFoundException(`Invitation "${id}" not found.`);
    if (actor.type === "founder_user") {
      // co_founder invitations have no founderId (there's no existing
      // Founder to point at yet) — ownership for those is checked via
      // the actor's own foundation_founders membership on the named
      // Foundation instead. Same 404-not-403 posture either way: never
      // confirm another Founder's/Foundation's invitation exists.
      const ownsViaFounderId = invitation.founderId === actor.founderId;
      const ownsViaFoundation =
        !invitation.founderId &&
        invitation.foundationId &&
        actor.founderId &&
        (await prisma.foundationFounder.findUnique({
          where: { foundationId_founderId: { foundationId: invitation.foundationId, founderId: actor.founderId } },
        })) !== null;
      if (!ownsViaFounderId && !ownsViaFoundation) {
        throw new NotFoundException(`Invitation "${id}" not found.`);
      }
    }
    if (invitation.status !== "pending") {
      throw new BadRequestException(
        `Invitation "${id}" is already ${invitation.status}.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const revoked = await tx.invitation.update({
        where: { id },
        data: { status: "revoked" },
      });

      await tx.auditLog.create({
        data: {
          actorType: actor.type,
          actorUserId: revokedByUserId,
          actorFounderId: actor.type === "founder_user" ? actor.founderId : undefined,
          action: "invitation.revoked",
          entityType: "Invitation",
          entityId: id,
          before: invitation as any,
          after: revoked as any,
        },
      });

      return revoked;
    });
  }

  findById(id: string) {
    return prisma.invitation.findUnique({ where: { id } });
  }

  list() {
    return prisma.invitation.findMany({ orderBy: { createdAt: "desc" } });
  }

  // Founder-Portal — a primary contact's own view of who they've
  // invited to their Foundation, pending or otherwise.
  //
  // Now wrapped in withFounderScope (2026-09-08 audit fix, reversing this
  // method's own prior reasoning): invitations was the one founder
  // -reachable table left out of the founder_isolation RLS expansion, with
  // no comment marking that as deliberate — "the WHERE clause below is
  // already exact-match" was true but meant RLS had nothing to actually
  // catch if a future edit to this WHERE clause ever got it wrong. This
  // costs nothing today and gives that second layer something real to
  // enforce.
  //
  // co_founder invitations have no founderId (there's no existing
  // Founder to point at), so they'd otherwise never show up here for
  // the inviting founder — surfaced instead via the Foundation(s) this
  // founder is actually attached to.
  async listForFounder(founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const foundationFounders = await tx.foundationFounder.findMany({
        where: { founderId },
        select: { foundationId: true },
      });
      const foundationIds = foundationFounders.map((ff) => ff.foundationId);
      return tx.invitation.findMany({
        where: { OR: [{ founderId }, { foundationId: { in: foundationIds } }] },
        orderBy: { createdAt: "desc" },
      });
    });
  }
}

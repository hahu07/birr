import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { prisma, Prisma, Invitation, InviteeKind, BirrStaffRole, FounderPermissionLevel, FounderKind, InstitutionType } from "@birr/db";
import { hashPassword } from "../../common/auth/password-auth";
import { ResendInvitationEmailAdapter } from "./email/resend-invitation.adapter";
import { NotificationsService } from "../notifications/notifications.service";
import {
  resolveFounderTeammateUserIds,
  resolveFounderRecipientUserIdsForFoundation,
} from "../../common/notifications/resolve-founder-recipients";
import { withFounderScope } from "../../common/db/founder-scope";
import { staffHasAccess } from "../../common/auth/staff-permissions";

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

export function newInvitationToken() {
  return {
    token: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + INVITATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000),
  };
}

// Whoever holds an invitation's token can accept it — choosing the
// password for an account with the invitee's email and role — so it never
// goes into audit_logs, which audit_committee/external_auditor can read.
export function invitationAuditSnapshot(invitation: Invitation) {
  return { ...invitation, token: "[redacted]" };
}

// A new staff invitation (staff.invite approval, or the first-approver
// bootstrap script) can't target an email that already has an account —
// accept() would refuse it anyway — or a still-pending staff invitation.
export async function assertStaffInvitable(email: string, db: Prisma.TransactionClient) {
  const existingUser = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  if (existingUser) {
    throw new ConflictException(`An account already exists for ${email}.`);
  }
  const pendingInvitation = await db.invitation.findFirst({
    where: { inviteeKind: "birr_staff", status: "pending", expiresAt: { gt: new Date() }, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (pendingInvitation) {
    throw new ConflictException(`${email} already has a pending staff invitation — revoke it first to invite them in a different role.`);
  }
}

// Staff invitation links are delivered by email only (owner decision,
// 2026-10-18). Returning the token to the Ops Console let any signed-in
// staff member copy a pending link and take that seat — including a
// Platform Admin taking a seat the staff.invite approval granted someone
// else. Founder-side tokens are unchanged: those pages keep their
// copy-link fallback.
export function redactStaffInvitationToken<T extends { inviteeKind: InviteeKind; token: string }>(
  invitation: T,
): Omit<T, "token"> & { token: string | null } {
  return invitation.inviteeKind === "birr_staff" ? { ...invitation, token: null } : invitation;
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

  /**
   * Founder-side invitations only (founder_user, co_founder). A Birr staff
   * invitation is never created here: since 2026-10-18 adding a staff
   * member is the `staff.invite` governed action — proposed by a
   * platform_admin, approved by a different board_of_trustees /
   * compliance_officer member — which calls createStaffInvitationInTransaction()
   * below on approval. Before that, one Platform Admin could invite anyone
   * into any role alone, including a second account of their own under a
   * checker role.
   */
  async invite(input: InviteInput) {
    if (input.inviteeKind === "birr_staff") {
      throw new BadRequestException(
        "Adding a Birr staff member needs a second person's approval — propose it (staff.invite) instead of sending an invitation directly.",
      );
    }
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
    } else {
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
    }

    const invitation = await prisma.$transaction(async (tx) => {
      const created = await tx.invitation.create({
        data: {
          inviteeKind: input.inviteeKind,
          email: input.email,
          founderId: input.founderId,
          foundationId: input.foundationId,
          roleKey: input.roleKey,
          invitedBy: input.invitedByUserId,
          ...newInvitationToken(),
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
          after: invitationAuditSnapshot(created),
        },
      });

      return created;
    });

    const emailSent = await this.deliver(invitation, input.invitedByActorType ?? "birr_staff");
    return { ...invitation, emailSent };
  }

  /**
   * The `staff.invite` governed action's fulfillment — called only from
   * GovernedActionsService.decide() on approval, inside its transaction,
   * which also writes the audit record. Deliberately sends nothing: the
   * email goes out via deliverById() only after that transaction commits.
   */
  createStaffInvitationInTransaction(
    input: { email: string; roleKey: string; invitedByUserId: string },
    tx: Prisma.TransactionClient,
  ) {
    if (!Object.values(BirrStaffRole).includes(input.roleKey as BirrStaffRole)) {
      throw new BadRequestException(`"${input.roleKey}" is not a valid BirrStaffRole.`);
    }
    return tx.invitation.create({
      data: {
        inviteeKind: "birr_staff",
        email: input.email,
        roleKey: input.roleKey,
        invitedBy: input.invitedByUserId,
        ...newInvitationToken(),
      },
    });
  }

  /** Post-commit delivery for an invitation created inside someone else's transaction. */
  async deliverById(invitationId: string): Promise<boolean> {
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } });
    return this.deliver(invitation, "birr_staff");
  }

  /**
   * The only way a staff invitation's link reaches anyone after it's
   * sent: its token is never returned by the API (see
   * redactStaffInvitationToken), so if the first email failed, a
   * platform_admin resends it to the same address — never a copy-able link.
   */
  async resendStaffInvitationEmail(id: string, actorUserId: string) {
    const invitation = await prisma.invitation.findUnique({ where: { id } });
    if (!invitation || invitation.inviteeKind !== "birr_staff") {
      throw new NotFoundException(`Staff invitation "${id}" not found.`);
    }
    if (invitation.status !== "pending" || invitation.expiresAt < new Date()) {
      throw new BadRequestException("Only a pending, unexpired invitation can be resent.");
    }
    const emailSent = await this.sendEmail(invitation);
    await prisma.auditLog.create({
      data: {
        actorType: "birr_staff",
        actorUserId,
        action: "invitation.email_resent",
        entityType: "Invitation",
        entityId: invitation.id,
        after: { email: invitation.email, emailSent },
      },
    });
    return { emailSent };
  }

  // Best-effort, outside any transaction — a Resend outage or missing
  // config shouldn't roll back a real invitation record. emailSent tells
  // the caller whether it went out: founder-side pages fall back to a
  // copy-link; staff invitations fall back to resendStaffInvitationEmail().
  private async sendEmail(invitation: Invitation): Promise<boolean> {
    try {
      const inviter = await prisma.user.findUnique({ where: { id: invitation.invitedBy } });
      const portalUrl = process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000";
      // co_founder invitations carry the invitee kind on the link itself
      // (?kind=co_founder) — the accept page only ever has the token to
      // go on, and this is cheaper than a new lookup-by-token endpoint.
      const acceptUrl =
        invitation.inviteeKind === "co_founder"
          ? `${portalUrl}/ops/accept-invitation?token=${invitation.token}&kind=co_founder`
          : `${portalUrl}/ops/accept-invitation?token=${invitation.token}`;
      await this.emailAdapter.sendInvitationEmail(invitation.email, acceptUrl, {
        inviteeKind: invitation.inviteeKind,
        roleLabel: invitation.inviteeKind === "co_founder" ? "a co-founder" : humanizeRoleKey(invitation.roleKey ?? ""),
        invitedByName: inviter?.fullName ?? "A Birr team member",
      });
      return true;
    } catch (err) {
      this.logger.error(`Couldn't send invitation email to ${invitation.email}:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  private async deliver(invitation: Invitation, inviterType: "birr_staff" | "founder_user"): Promise<boolean> {
    const emailSent = await this.sendEmail(invitation);

    // In-app confirmation to whoever sent it — not the invitee (they have
    // no account yet; the email above is their actual invitation) — see
    // CHANNEL_PLAN: in-app only, no need to also email someone about an
    // action they took themselves.
    this.notificationsService
      .notify({
        recipientType: inviterType,
        recipientUserId: invitation.invitedBy,
        type: "invitation.sent",
        title: "Invitation sent",
        body:
          invitation.inviteeKind === "co_founder"
            ? `You invited ${invitation.email} to co-found your Foundation.`
            : `You invited ${invitation.email} as ${humanizeRoleKey(invitation.roleKey ?? "")}.`,
        linkUrl:
          invitation.inviteeKind === "founder_user"
            ? "/team"
            : invitation.inviteeKind === "co_founder"
              ? `/foundations/${invitation.foundationId}`
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

    return emailSent;
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
          after: invitationAuditSnapshot(accepted),
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
    actor: { type: "birr_staff"; staffRole: string } | { type: "founder_user"; founderId: string },
  ) {
    const invitation = await prisma.invitation.findUnique({ where: { id } });
    if (!invitation) throw new NotFoundException(`Invitation "${id}" not found.`);
    // Revoking a pending staff invitation is staff.invitation_manage
    // (platform_admin) — it was otherwise open to any staff role.
    if (
      actor.type === "birr_staff" &&
      invitation.inviteeKind === "birr_staff" &&
      !(await staffHasAccess(actor, "staff.invitation_manage"))
    ) {
      throw new ForbiddenException("You don't have permission to revoke a Birr staff invitation.");
    }
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
          before: invitationAuditSnapshot(invitation),
          after: invitationAuditSnapshot(revoked),
        },
      });

      return revoked;
    });
  }

  async findById(id: string) {
    const invitation = await prisma.invitation.findUnique({ where: { id } });
    return invitation && redactStaffInvitationToken(invitation);
  }

  async list() {
    const invitations = await prisma.invitation.findMany({ orderBy: { createdAt: "desc" } });
    return invitations.map(redactStaffInvitationToken);
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

import { EmailField, IdField, Trimmed } from "../../common/validation/fields";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { prisma, Prisma, type PrimaryContactSuccession } from "@birr/db";
import { holdsAnyRole } from "../../common/auth/staff-roles";
import { NotificationsService } from "../notifications/notifications.service";
import { newInvitationToken } from "../invitations/invitations.service";
import { stepDownOutgoing, stepUpAndComplete } from "./succession-swap";
import { SettingsService } from "../../common/settings/settings.service";
import { OUTGOING_NOTICE_VERSION, outgoingNotice } from "./succession-notice";

// 7 days: the owner's decision, confirmed 2026-11-16 (long enough to notice
// a message while away or unwell; short enough that a family isn't stuck).
const OBJECTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const OPEN = ["requested", "approved", "objected"] as const;

/** Who takes over: an existing member, or someone new (email and name). */
class NewContactInput {
  @IsOptional()
  @IdField()
  newMembershipId?: string;

  @IsOptional()
  @EmailField()
  newEmail?: string;

  @Trimmed()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  newFullName?: string;
}

export class RequestHandoverInput extends NewContactInput {
  @Trimmed()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}

export class ReportUnavailableInput extends NewContactInput {
  @Trimmed()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  /** What happened, and what proof the member can give Birr (a death certificate, a board resolution...). */
  @Trimmed()
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  evidenceNote!: string;
}

export class RecordUnreachableInput extends ReportUnavailableInput {
  @IdField()
  founderId!: string;
}

export class SuccessionNoteInput {
  @Trimmed()
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  note!: string;
}

export interface FounderMember {
  userId: string;
  founderId: string;
}

function parseChangePayload(payload: unknown): { successionId: string } {
  const { successionId } = (payload ?? {}) as { successionId?: unknown };
  if (typeof successionId !== "string" || !successionId) throw new BadRequestException("A succession case is required.");
  return { successionId };
}

const formatDay = (d: Date) =>
  new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(d);

/**
 * Handing a Founder's primary contact role to someone new (owner's
 * decisions, 2026-11-15; see PrimaryContactSuccession's schema comment).
 * Two ways in — the contact asks (handover), or the contact is gone
 * (unreachable: reported by a member, or recorded by a Mutawalli Officer)
 * — and one way through: the governed founder.primary_contact_change,
 * proposed by a Mutawalli Officer and approved by Compliance or the Board.
 * An unreachable case can't be approved until the outgoing contact has
 * had 7 days' notice to object.
 */
@Injectable()
export class FounderSuccessionService {
  private readonly logger = new Logger(FounderSuccessionService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  // ─── Asking ──────────────────────────────────────────────────────────

  /** The primary contact asks to hand over. Birr confirms before it takes effect. */
  async requestHandover(member: FounderMember, input: RequestHandoverInput) {
    const outgoing = await this.activePrimary(member.founderId);
    if (!outgoing || outgoing.userId !== member.userId) {
      throw new ForbiddenException("Only the primary contact can hand over the role.");
    }
    return this.open({ founderId: member.founderId, kind: "handover", outgoingMembershipId: outgoing.id, input, requestedByUserId: member.userId });
  }

  /** Another member says the primary contact can't act. Birr checks before anything changes. */
  async reportUnavailable(member: FounderMember, input: ReportUnavailableInput) {
    const outgoing = await this.activePrimary(member.founderId);
    if (!outgoing) throw new BadRequestException("This Founder has no active primary contact.");
    if (outgoing.userId === member.userId) {
      throw new BadRequestException("You're the primary contact: hand the role over instead.");
    }
    await this.assertActiveMember(member);
    return this.open({
      founderId: member.founderId,
      kind: "unreachable",
      outgoingMembershipId: outgoing.id,
      input,
      evidenceNote: input.evidenceNote,
      requestedByUserId: member.userId,
    });
  }

  /** A Mutawalli Officer records a case for family or an institution who contacted Birr, with the evidence seen. */
  async recordUnreachable(staffUserId: string, input: RecordUnreachableInput) {
    const outgoing = await this.activePrimary(input.founderId);
    if (!outgoing) throw new BadRequestException("This Founder has no active primary contact.");
    return this.open({
      founderId: input.founderId,
      kind: "unreachable",
      outgoingMembershipId: outgoing.id,
      input,
      evidenceNote: input.evidenceNote,
      recordedByUserId: staffUserId,
    });
  }

  private async open(args: {
    founderId: string;
    kind: "handover" | "unreachable";
    outgoingMembershipId: string;
    input: NewContactInput & { reason: string };
    evidenceNote?: string;
    requestedByUserId?: string;
    recordedByUserId?: string;
  }) {
    const target = await this.resolveNewContact(args.founderId, args.outgoingMembershipId, args.input);
    const now = new Date();
    let created: PrimaryContactSuccession;
    try {
      created = await prisma.$transaction(async (tx) => {
        const row = await tx.primaryContactSuccession.create({
          data: {
            founderId: args.founderId,
            kind: args.kind,
            outgoingMembershipId: args.outgoingMembershipId,
            ...target,
            reason: args.input.reason.trim(),
            evidenceNote: args.evidenceNote?.trim(),
            requestedByUserId: args.requestedByUserId,
            recordedByUserId: args.recordedByUserId,
            // The contact who asked needs no notice; one who's said to be
            // gone gets 7 days to say otherwise.
            outgoingNotifiedAt: args.kind === "unreachable" ? now : null,
            earliestApprovalAt: args.kind === "unreachable" ? new Date(now.getTime() + OBJECTION_WINDOW_MS) : now,
          },
        });
        await tx.auditLog.create({
          data: {
            ...(args.recordedByUserId ? { actorType: "birr_staff" as const, actorUserId: args.recordedByUserId } : { actorType: "founder_user" as const, actorUserId: args.requestedByUserId, actorFounderId: args.founderId }),
            action: args.kind === "handover" ? "founder_succession.handover_requested" : "founder_succession.unreachable_reported",
            entityType: "PrimaryContactSuccession",
            entityId: row.id,
            // Which wording of the outgoing contact's notice was sent.
            after: (args.kind === "unreachable" ? { ...row, outgoingNoticeVersion: OUTGOING_NOTICE_VERSION } : row) as unknown as Prisma.InputJsonValue,
          },
        });
        return row;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("This Founder already has an open request to change its primary contact.");
      }
      throw err;
    }
    await this.notifyOpened(created);
    return created;
  }

  /** An existing active member of this Founder (not the outgoing one), or someone who isn't on Birr yet. */
  private async resolveNewContact(founderId: string, outgoingMembershipId: string, input: NewContactInput) {
    if (input.newMembershipId) {
      const membership = await prisma.founderMembership.findUnique({ where: { id: input.newMembershipId } });
      if (!membership || membership.founderId !== founderId || membership.status !== "active") {
        throw new BadRequestException("The new primary contact must be an active member of this Founder.");
      }
      if (membership.id === outgoingMembershipId) throw new BadRequestException("That's the current primary contact.");
      return { newMembershipId: membership.id };
    }
    const email = input.newEmail?.trim().toLowerCase();
    const fullName = input.newFullName?.trim();
    if (!email || !fullName) throw new BadRequestException("Choose a member, or give the new person's email and full name.");
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const membership = await prisma.founderMembership.findFirst({ where: { founderId, userId: user.id, status: "active" } });
      if (membership && membership.id !== outgoingMembershipId) return { newMembershipId: membership.id };
      throw new BadRequestException("That person already has a Birr account. Invite them to your team first, then choose them.");
    }
    return { newEmail: email, newFullName: fullName };
  }

  // ─── Objecting, cancelling ───────────────────────────────────────────

  /** Only the outgoing contact can object. Approval is then refused until staff look into it. */
  async object(id: string, userId: string, input: SuccessionNoteInput) {
    const succession = await this.load(id);
    const outgoing = await prisma.founderMembership.findUniqueOrThrow({ where: { id: succession.outgoingMembershipId } });
    if (outgoing.userId !== userId) throw new ForbiddenException("Only the person being replaced can object.");
    return this.transition(succession, ["requested"], { status: "objected", objectedAt: new Date(), objectionNote: input.note.trim() }, "founder_succession.objected", {
      actorType: "founder_user",
      actorUserId: userId,
      actorFounderId: succession.founderId,
    });
  }

  /** Whoever asked can withdraw it before it's decided. */
  async cancelByRequester(id: string, userId: string) {
    const succession = await this.load(id);
    if (succession.requestedByUserId !== userId) throw new ForbiddenException("Only the person who asked can withdraw this.");
    return this.transition(succession, ["requested"], { status: "cancelled" }, "founder_succession.cancelled", {
      actorType: "founder_user",
      actorUserId: userId,
      actorFounderId: succession.founderId,
    });
  }

  /** Staff close an open case (e.g. after an objection), with a note. */
  /**
   * The outgoing contact objected without signing in (by phone, email or
   * letter): staff record it on their behalf, with what was said and how
   * Birr knows it was them. Same effect as their own objection.
   */
  async recordObjection(id: string, staffUserId: string, input: SuccessionNoteInput) {
    const succession = await this.load(id);
    if (succession.kind !== "unreachable") throw new BadRequestException("Only a report that the contact can't act can be objected to.");
    return this.transition(
      succession,
      ["requested"],
      { status: "objected", objectedAt: new Date(), objectionNote: `Received by Birr: ${input.note.trim()}` },
      "founder_succession.objection_recorded",
      { actorType: "birr_staff", actorUserId: staffUserId },
    );
  }

  async closeByStaff(id: string, staffUserId: string, input: SuccessionNoteInput) {
    const succession = await this.load(id);
    return this.transition(succession, ["requested", "objected"], { status: "cancelled" }, "founder_succession.closed", { actorType: "birr_staff", actorUserId: staffUserId }, input.note.trim());
  }

  private async transition(
    succession: PrimaryContactSuccession,
    from: string[],
    data: Prisma.PrimaryContactSuccessionUpdateManyMutationInput,
    action: string,
    actor: { actorType: "founder_user" | "birr_staff"; actorUserId: string; actorFounderId?: string },
    note?: string,
  ) {
    const updated = await prisma.$transaction(async (tx) => {
      const claim = await tx.primaryContactSuccession.updateMany({ where: { id: succession.id, status: { in: from as never } }, data });
      if (claim.count !== 1) throw new ConflictException("This request has moved on; reload to see where it stands.");
      const after = await tx.primaryContactSuccession.findUniqueOrThrow({ where: { id: succession.id } });
      await tx.auditLog.create({
        data: {
          ...actor,
          action,
          entityType: "PrimaryContactSuccession",
          entityId: succession.id,
          before: succession as unknown as Prisma.InputJsonValue,
          after: (note ? { ...after, note } : after) as unknown as Prisma.InputJsonValue,
        },
      });
      return after;
    });
    await this.notifyMembers(updated, action);
    return updated;
  }

  // ─── The governed action founder.primary_contact_change ─────────────

  async validateChange(payload: unknown) {
    const succession = await this.load(parseChangePayload(payload).successionId);
    await this.assertChangeable(succession, prisma);
  }

  async checkDuplicateChange(payload: unknown) {
    const { successionId } = parseChangePayload(payload);
    const permission = await prisma.permission.findUnique({ where: { key: "founder.primary_contact_change" } });
    const pending = await prisma.governedAction.findFirst({
      where: { permissionId: permission?.id, status: "proposed", payload: { path: ["successionId"], equals: successionId } },
    });
    if (pending) throw new ConflictException("This change is already awaiting approval.");
  }

  async describeChange(payload: unknown) {
    const succession = await prisma.primaryContactSuccession.findUnique({
      where: { id: parseChangePayload(payload).successionId },
      include: {
        founder: { select: { name: true } },
        outgoingMembership: { include: { user: { select: { fullName: true, email: true } } } },
        newMembership: { include: { user: { select: { fullName: true, email: true } } } },
      },
    });
    if (!succession) return "Succession case not found.";
    const incoming = succession.newMembership
      ? `${succession.newMembership.user.fullName} (already a member)`
      : `${succession.newFullName} <${succession.newEmail}> (new to Birr; invited on approval)`;
    const timing =
      succession.kind === "unreachable"
        ? ` The outgoing contact was notified on ${formatDay(succession.outgoingNotifiedAt ?? succession.createdAt)}; it can't be approved before ${formatDay(succession.earliestApprovalAt)}.${succession.objectedAt ? " THEY OBJECTED." : ""}`
        : "";
    return (
      `${succession.kind === "handover" ? "Handover requested by the primary contact" : "Primary contact reported unable to act"} for ${succession.founder.name}: ` +
      `${succession.outgoingMembership.user.fullName} → ${incoming}. Reason: "${succession.reason}".` +
      (succession.evidenceNote ? ` Evidence: "${succession.evidenceNote}".` : "") +
      timing +
      " Confirm through a separate channel before approving."
    );
  }

  /** At approval, inside the decision's transaction: re-check everything, then swap (or invite someone new). */
  async approveChange(payload: unknown, tx: Prisma.TransactionClient, ctx: { checkerUserId: string; makerUserId: string | null; governedActionId: string }) {
    const { successionId } = parseChangePayload(payload);
    const before = await tx.primaryContactSuccession.findUnique({ where: { id: successionId } });
    if (!before) throw new NotFoundException("Succession case not found.");
    // Serializes changes to this Founder's primary contact (taken before any audit row is written).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"founder_primary_contact:" + before.founderId}))`;
    const succession = await tx.primaryContactSuccession.findUniqueOrThrow({ where: { id: successionId } });
    await this.assertChangeable(succession, tx);
    if (new Date() < succession.earliestApprovalAt) {
      throw new BadRequestException(`This can't be approved before ${formatDay(succession.earliestApprovalAt)}: the outgoing contact has until then to object.`);
    }
    if (!ctx.makerUserId) throw new BadRequestException("A primary contact change must be proposed by a person.");

    await tx.primaryContactSuccession.update({ where: { id: succession.id }, data: { governedActionId: ctx.governedActionId } });
    // A contact who's gone steps down now. One who asked to hand over keeps
    // the role until their successor is actually in place, so the Founder
    // is never left without one if an invitation goes unanswered.
    if (succession.newMembershipId || succession.kind === "unreachable") await stepDownOutgoing(tx, succession);
    if (succession.newMembershipId) {
      const completed = await stepUpAndComplete(tx, succession, succession.newMembershipId);
      return { auditAction: "founder_succession.approved", entityType: "PrimaryContactSuccession", entityId: succession.id, before: succession, after: completed };
    }
    // Someone new: invited now, and the swap completes when they accept
    // (InvitationsService.accept). For an unreachable contact the Founder
    // has no active primary contact until then; that one is gone anyway.
    const invitation = await tx.invitation.create({
      data: {
        inviteeKind: "founder_user",
        email: succession.newEmail!,
        founderId: succession.founderId,
        roleKey: "primary_contact",
        invitedBy: ctx.makerUserId,
        ...newInvitationToken(),
      },
    });
    const approved = await tx.primaryContactSuccession.update({ where: { id: succession.id }, data: { status: "approved", invitationId: invitation.id } });
    // entityType "Invitation" makes decide() email it after commit, as for staff invitations.
    return {
      auditAction: "invitation.sent",
      entityType: "Invitation",
      entityId: invitation.id,
      before: null,
      after: { invitationId: invitation.id, email: invitation.email, roleKey: "primary_contact", successionId: succession.id, approvedByUserId: ctx.checkerUserId, succession: approved },
    };
  }

  async rejectChange(payload: unknown, tx: Prisma.TransactionClient) {
    const { successionId } = parseChangePayload(payload);
    const before = await tx.primaryContactSuccession.findUniqueOrThrow({ where: { id: successionId } });
    const after = before.status === "requested" ? await tx.primaryContactSuccession.update({ where: { id: successionId }, data: { status: "rejected" } }) : before;
    return { auditAction: "founder_succession.rejected", entityType: "PrimaryContactSuccession", entityId: successionId, before, after };
  }

  /** After the decision commits: tell the Founder's members (and the outgoing contact) what happened. */
  async afterDecision(payload: unknown, approved: boolean) {
    const succession = await prisma.primaryContactSuccession.findUnique({ where: { id: parseChangePayload(payload).successionId } });
    if (succession) await this.notifyMembers(succession, approved ? `founder_succession.${succession.status}` : "founder_succession.rejected");
  }

  private async assertChangeable(succession: PrimaryContactSuccession, db: Prisma.TransactionClient) {
    if (succession.status === "objected") throw new BadRequestException("The outgoing contact objected. Look into it, then close this request.");
    if (succession.status !== "requested") throw new BadRequestException(`This request is ${succession.status}.`);
    const outgoing = await db.founderMembership.findUnique({ where: { id: succession.outgoingMembershipId } });
    if (!outgoing || outgoing.status !== "active" || outgoing.permissionLevel !== "primary_contact") {
      throw new BadRequestException("The outgoing person is no longer this Founder's primary contact.");
    }
    if (succession.newMembershipId) {
      const incoming = await db.founderMembership.findUnique({ where: { id: succession.newMembershipId } });
      if (!incoming || incoming.status !== "active") throw new BadRequestException("The new primary contact is no longer an active member.");
    }
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  private static readonly DETAIL = {
    outgoingMembership: { include: { user: { select: { id: true, fullName: true, email: true } } } },
    newMembership: { include: { user: { select: { id: true, fullName: true, email: true } } } },
    requestedBy: { select: { fullName: true } },
    recordedBy: { select: { fullName: true } },
  } as const;

  /** A Founder's cases, newest first, for its members. Which staff member
   * recorded a case is Birr's internal record, not shown to founders. */
  listForFounder(founderId: string) {
    const { recordedBy: _staff, ...include } = FounderSuccessionService.DETAIL;
    return prisma.primaryContactSuccession.findMany({ where: { founderId }, orderBy: { createdAt: "desc" }, take: 20, include });
  }

  /** Staff: open cases (or every case for one Founder), each marked with
   * the change awaiting approval for it, if one has been proposed. */
  async listForStaff(filter: { founderId?: string }) {
    const cases = await prisma.primaryContactSuccession.findMany({
      where: filter.founderId ? { founderId: filter.founderId } : { status: { in: [...OPEN] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { ...FounderSuccessionService.DETAIL, founder: { select: { id: true, name: true } } },
    });
    const requested = cases.filter((c) => c.status === "requested").map((c) => c.id);
    const pending = requested.length
      ? await prisma.governedAction.findMany({
          where: { permission: { key: "founder.primary_contact_change" }, status: "proposed", OR: requested.map((id) => ({ payload: { path: ["successionId"], equals: id } })) },
          select: { id: true, payload: true, makerUser: { select: { fullName: true } } },
        })
      : [];
    const bySuccession = new Map(pending.map((a) => [(a.payload as { successionId?: string }).successionId, { id: a.id, proposedBy: a.makerUser?.fullName ?? null }]));
    return cases.map((c) => ({ ...c, pendingApproval: bySuccession.get(c.id) ?? null }));
  }

  private async load(id: string) {
    const succession = await prisma.primaryContactSuccession.findUnique({ where: { id } });
    if (!succession) throw new NotFoundException("Request not found.");
    return succession;
  }

  private activePrimary(founderId: string) {
    return prisma.founderMembership.findFirst({ where: { founderId, permissionLevel: "primary_contact", status: "active" } });
  }

  private async assertActiveMember(member: FounderMember) {
    const membership = await prisma.founderMembership.findFirst({ where: { founderId: member.founderId, userId: member.userId, status: "active" } });
    if (!membership) throw new ForbiddenException("Only an active member of this Founder can ask.");
  }

  // ─── Telling people ──────────────────────────────────────────────────

  private async notifyOpened(succession: PrimaryContactSuccession) {
    const founder = await prisma.founder.findUniqueOrThrow({ where: { id: succession.founderId }, select: { name: true } });
    const officers = await prisma.birrStaff.findMany({ where: { status: "active", ...holdsAnyRole("mutawalli_officer") }, select: { userId: true } });
    const sends: Promise<void>[] = officers.map((o) =>
      this.notifications.notify({
        recipientType: "birr_staff",
        recipientUserId: o.userId,
        type: "founder_succession.requested",
        title: `Primary contact change requested: ${founder.name}`,
        body: succession.kind === "handover" ? "The primary contact has asked to hand over the role." : "The primary contact has been reported unable to act. Check the evidence.",
        linkUrl: "/ops/founder-succession",
        relatedEntityType: "PrimaryContactSuccession",
        relatedEntityId: succession.id,
      }),
    );
    if (succession.kind === "unreachable") {
      // The one message that matters most: the outgoing contact hears first, by email and WhatsApp.
      const outgoing = await prisma.founderMembership.findUniqueOrThrow({ where: { id: succession.outgoingMembershipId } });
      // They may have lost access to their account, so the notice also
      // says how to reach Birr without signing in.
      const [email, phone] = await Promise.all([this.settings.get("support", "CONTACT_EMAIL"), this.settings.get("support", "CONTACT_PHONE")]);
      if (!email && !phone) this.logger.warn("No Birr contact set (Platform Settings → support): the outgoing contact's notice can only say 'contact Birr directly'.");
      const notice = outgoingNotice({ founderName: founder.name, objectBy: formatDay(succession.earliestApprovalAt), contact: { email, phone } });
      sends.push(
        this.notifications.notify({
          recipientType: "founder_user",
          recipientUserId: outgoing.userId,
          type: "founder_succession.outgoing_notice",
          title: notice.title,
          body: notice.body,
          emailFooter: notice.emailFooter,
          emailReplyTo: email ?? undefined,
          linkUrl: "/team",
          relatedEntityType: "PrimaryContactSuccession",
          relatedEntityId: succession.id,
        }),
      );
    }
    await Promise.all(sends.map((p) => p.catch((err) => this.logger.error("Succession notification failed:", err instanceof Error ? err.stack : String(err)))));
    await this.notifyMembers(succession, "founder_succession.requested");
  }

  private async notifyMembers(succession: PrimaryContactSuccession, action: string) {
    const titles: Record<string, string> = {
      "founder_succession.requested": "A change of primary contact has been requested",
      "founder_succession.completed": "Your Founder has a new primary contact",
      "founder_succession.approved": "A new primary contact has been invited",
      "founder_succession.rejected": "The request to change primary contact was declined",
      "founder_succession.objected": "The primary contact objected to being replaced",
      "founder_succession.cancelled": "The request to change primary contact was withdrawn",
      "founder_succession.closed": "Birr closed the request to change primary contact",
    };
    const title = titles[action];
    if (!title) return;
    const members = await prisma.founderMembership.findMany({ where: { founderId: succession.founderId, status: "active" }, select: { userId: true } });
    const recipients = new Set(members.map((m) => m.userId));
    // The outgoing contact hears the outcome even once they're revoked.
    const outgoing = await prisma.founderMembership.findUnique({ where: { id: succession.outgoingMembershipId }, select: { userId: true } });
    if (outgoing) recipients.add(outgoing.userId);
    await Promise.all(
      [...recipients].map((userId) =>
        this.notifications
          .notify({
            recipientType: "founder_user",
            recipientUserId: userId,
            type: "founder_succession.update",
            title,
            body: "See your Team page for details.",
            linkUrl: "/team",
            relatedEntityType: "PrimaryContactSuccession",
            relatedEntityId: succession.id,
          })
          .catch((err) => this.logger.error("Succession notification failed:", err instanceof Error ? err.stack : String(err))),
      ),
    );
  }
}

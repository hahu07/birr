import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, ActorType } from "@birr/db";
import { ResendNotificationEmailAdapter } from "./email/resend-notification.adapter";
import { TwilioWhatsAppAdapter } from "../../common/whatsapp/twilio-whatsapp.adapter";
import { renderWhatsAppMessage } from "../../common/whatsapp/notification-message";

export interface NotifyInput {
  recipientType: ActorType;
  recipientUserId: string;
  /** A stable machine key, e.g. "governed_action.proposed" — see CHANNEL_PLAN below. */
  type: string;
  title: string;
  body: string;
  linkUrl?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

/**
 * Which channels a notification type reaches beyond in-app (which is
 * always on — see notify() below). This is the single place channel
 * policy lives; callers pass a `type` and never decide channels
 * themselves, so the priority tiers agreed with the user (Critical/
 * High/Medium/Low, see docs/) stay reviewable in one file instead of
 * scattered across every call site.
 *
 * Absent from this map = in-app only (the safe default) — a new
 * notification type that forgets to register here fails quiet, not loud.
 */
const CHANNEL_PLAN: Record<string, { email: boolean; whatsapp: boolean }> = {
  // Critical — a governed action needs a checker. The one notification
  // type that justifies WhatsApp on day one.
  "governed_action.proposed": { email: true, whatsapp: true },
  // High — the founder whose waqf it was, told what Birr staff decided.
  "governed_action.decided": { email: true, whatsapp: false },
  // Feedback to the maker that their own proposal was decided — in-app
  // is enough, this isn't time-sensitive the way the proposal itself was.
  "governed_action.decided.own": { email: false, whatsapp: false },

  // High — a durable financial/account record the founder should have in
  // their inbox and on WhatsApp, not just in-app — these are the events a
  // founder actually checks their phone for.
  "distribution.paid": { email: true, whatsapp: true },
  "contribution.confirmed": { email: true, whatsapp: true },
  "contribution.failed": { email: true, whatsapp: true },
  "waqf.activated": { email: true, whatsapp: true },
  // In-app confirmation of your own action — no need to also email yourself.
  "invitation.sent": { email: false, whatsapp: false },
  "founder_membership.joined": { email: true, whatsapp: true },
  "foundation.co_founder_joined": { email: true, whatsapp: true },
  "cause_suggestion.pending": { email: true, whatsapp: false },
  "cause_suggestion.reviewed": { email: true, whatsapp: false },
  // Low — nice-to-know, in-app is enough.
  "cause_impact_update.logged": { email: false, whatsapp: false },
  "waqf_deed.signed": { email: true, whatsapp: false },
  "foundation_deed.signed": { email: true, whatsapp: true },
  "trustee_license.status_changed": { email: true, whatsapp: false },
  "waqf.needs_case_assignment": { email: true, whatsapp: false },
  "coi.needs_review": { email: true, whatsapp: false },
  // Critical — escalated conflicts of interest are exactly the
  // time-sensitive, action-required case WhatsApp is reserved for.
  "coi.escalated": { email: true, whatsapp: true },
  // Feedback to the declarant — in-app only, same posture as governed_action.decided.own.
  "coi.reviewed": { email: false, whatsapp: false },
  // Critical — a trustee license lapsing blocks Birr from acting in that jurisdiction.
  "trustee_license.expiring": { email: true, whatsapp: true },
  // Medium — a real message from the other side of the relationship,
  // but not itself time-sensitive the way a governed-action proposal or
  // a payment event is. Same tier as cause_suggestion.pending.
  "message.received": { email: true, whatsapp: false },
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly emailAdapter: ResendNotificationEmailAdapter,
    private readonly whatsAppAdapter: TwilioWhatsAppAdapter,
  ) {}

  /**
   * Always writes the in-app row first — that's the one channel that
   * never fails silently and is the source of truth for the bell.
   * Email/WhatsApp are then independent, best-effort attempts: either
   * one failing (misconfigured Resend, no verified WhatsApp number)
   * never blocks the other or rolls back the in-app record, same
   * posture as InvitationsService.invite()'s email send this session.
   */
  async notify(input: NotifyInput): Promise<void> {
    const notification = await prisma.notification.create({
      data: {
        recipientType: input.recipientType,
        recipientUserId: input.recipientUserId,
        type: input.type,
        title: input.title,
        body: input.body,
        linkUrl: input.linkUrl,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
      },
    });

    const plan = CHANNEL_PLAN[input.type] ?? { email: false, whatsapp: false };
    if (!plan.email && !plan.whatsapp) return;

    const user = await prisma.user.findUnique({ where: { id: input.recipientUserId } });
    if (!user) return; // Shouldn't happen — the FK guarantees the row exists — but never throw over a best-effort send.

    if (plan.email) {
      try {
        await this.emailAdapter.sendNotificationEmail(user.email, {
          title: input.title,
          body: input.body,
          linkUrl: input.linkUrl,
        });
      } catch (err) {
        console.error(
          `Couldn't send notification email (${input.type}) to ${user.email}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (plan.whatsapp) {
      if (!user.whatsappNumber || !user.whatsappVerifiedAt) {
        console.log(`Skipping WhatsApp for notification "${notification.id}" — recipient has no verified number.`);
      } else {
        try {
          await this.sendWhatsApp(user.whatsappNumber, input);
        } catch (err) {
          console.error(
            `Couldn't send WhatsApp notification (${input.type}) to user ${user.id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  }

  private async sendWhatsApp(to: string, input: NotifyInput): Promise<void> {
    const message = renderWhatsAppMessage({
      type: input.type,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
    });
    await this.whatsAppAdapter.sendMessage(to, message);
  }

  list(recipientUserId: string) {
    return prisma.notification.findMany({
      where: { recipientUserId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markRead(id: string, recipientUserId: string): Promise<void> {
    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.recipientUserId !== recipientUserId) {
      // Indistinguishable from "id doesn't exist" — same posture as
      // every other ownership-scoped 404 in this codebase.
      throw new NotFoundException(`Notification "${id}" not found.`);
    }
    if (notification.readAt) return;
    await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(recipientUserId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { recipientUserId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { prisma, ActorType } from "@birr/db";
import { ResendNotificationEmailAdapter } from "./email/resend-notification.adapter";
import { TwilioWhatsAppAdapter } from "../../common/whatsapp/twilio-whatsapp.adapter";
import { renderWhatsAppMessage } from "../../common/whatsapp/notification-message";
import { resolvePortalLink } from "../../common/urls/resolve-portal-link";

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
  // Medium — staff-only, same tier as the two above: action-needed
  // (a portfolio has drifted from its stated target), not itself
  // time-critical the way a governed-action proposal is.
  "portfolio.drift_detected": { email: true, whatsapp: false },
  // Critical — escalated conflicts of interest are exactly the
  // time-sensitive, action-required case WhatsApp is reserved for.
  "coi.escalated": { email: true, whatsapp: true },
  // Feedback to the declarant — in-app only, same posture as governed_action.decided.own.
  "coi.reviewed": { email: false, whatsapp: false },
  // Critical — a trustee license lapsing blocks Birr from acting in that jurisdiction.
  "trustee_license.expiring": { email: true, whatsapp: true },
  // Critical — two-factor authentication on your own staff account was
  // reset. Always email + WhatsApp, never user-configurable (deliberately
  // not in TYPE_TO_PREFERENCE_CATEGORY): if someone is resetting MFA on an
  // account you didn't ask about, this is the message that lets you catch it.
  "birr_staff.mfa_reset": { email: true, whatsapp: true },
  // Medium — a real message from the other side of the relationship,
  // but not itself time-sensitive the way a governed-action proposal or
  // a payment event is. Same tier as cause_suggestion.pending.
  "message.received": { email: true, whatsapp: false },
};

// User-configurable categories — deliberately a small, named subset of
// the `type` keys above, not a 1:1 mirror of CHANNEL_PLAN. Every type
// left unmapped here (governed_action.proposed, coi.escalated,
// trustee_license.expiring, and the rest of the Critical tier, plus
// every staff-only/self-feedback type) is never user-configurable —
// see NotificationPreference's own schema comment on why that's a
// deliberate ceiling, not an oversight. The four categories below are
// exactly the ones a Founder Portal account actually receives day to
// day (see account/page.tsx's own notification-preferences section).
export const NOTIFICATION_PREFERENCE_CATEGORIES = ["governance", "money", "team", "messages"] as const;
export type NotificationPreferenceCategory = (typeof NOTIFICATION_PREFERENCE_CATEGORIES)[number];

const TYPE_TO_PREFERENCE_CATEGORY: Record<string, NotificationPreferenceCategory> = {
  "governed_action.decided": "governance",
  "waqf.activated": "governance",
  "foundation_deed.signed": "governance",
  "waqf_deed.signed": "governance",
  "distribution.paid": "money",
  "contribution.confirmed": "money",
  "contribution.failed": "money",
  "founder_membership.joined": "team",
  "foundation.co_founder_joined": "team",
  "cause_suggestion.reviewed": "team",
  "message.received": "messages",
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

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

    // A user preference can only narrow CHANNEL_PLAN, never widen it —
    // an unmapped type (most of the Critical tier) skips this lookup
    // entirely and always follows the plan above.
    const category = TYPE_TO_PREFERENCE_CATEGORY[input.type];
    const preference = category
      ? await prisma.notificationPreference.findUnique({
          where: { userId_category: { userId: user.id, category } },
        })
      : null;
    const emailAllowed = plan.email && (preference?.emailEnabled ?? true);
    const whatsappAllowed = plan.whatsapp && (preference?.whatsappEnabled ?? true);

    if (emailAllowed) {
      try {
        await this.emailAdapter.sendNotificationEmail(user.email, {
          title: input.title,
          body: input.body,
          // Absolute — see resolvePortalLink's own comment. input.linkUrl
          // itself stays relative in the in-app row created above; this
          // is a separately-resolved value for the external channel only.
          linkUrl: resolvePortalLink(input.linkUrl),
        });
      } catch (err) {
        this.logger.error(
          `Couldn't send notification email (${input.type}) to ${user.email}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (whatsappAllowed) {
      if (!user.whatsappNumber || !user.whatsappVerifiedAt) {
        this.logger.log(`Skipping WhatsApp for notification "${notification.id}" — recipient has no verified number.`);
      } else {
        try {
          await this.sendWhatsApp(user.whatsappNumber, input);
        } catch (err) {
          this.logger.error(
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
      // Absolute — see resolvePortalLink's own comment.
      linkUrl: resolvePortalLink(input.linkUrl),
    });
    await this.whatsAppAdapter.sendMessage(to, message);
  }

  // Every category defaults to {email: true, whatsapp: true} — the
  // CHANNEL_PLAN default — so a user who never visited this settings
  // page gets a full row set here rather than an empty array a
  // frontend would otherwise have to fill in with its own hardcoded
  // defaults (and risk drifting from this file's own defaults).
  async getPreferences(userId: string): Promise<Record<NotificationPreferenceCategory, { emailEnabled: boolean; whatsappEnabled: boolean }>> {
    const rows = await prisma.notificationPreference.findMany({ where: { userId } });
    const byCategory = new Map(rows.map((r) => [r.category, r]));
    return Object.fromEntries(
      NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => [
        category,
        {
          emailEnabled: byCategory.get(category)?.emailEnabled ?? true,
          whatsappEnabled: byCategory.get(category)?.whatsappEnabled ?? true,
        },
      ]),
    ) as Record<NotificationPreferenceCategory, { emailEnabled: boolean; whatsappEnabled: boolean }>;
  }

  setPreference(userId: string, category: NotificationPreferenceCategory, input: { emailEnabled: boolean; whatsappEnabled: boolean }) {
    return prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category } },
      update: { emailEnabled: input.emailEnabled, whatsappEnabled: input.whatsappEnabled },
      create: { userId, category, emailEnabled: input.emailEnabled, whatsappEnabled: input.whatsappEnabled },
    });
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

  /**
   * Marks every unread notification pointing at one specific entity as
   * read, for the caller's own notifications only. This is the generic
   * fix for a bug class first found (and fixed one-off, per-type) on
   * `message.received`: a notification's target content could be viewed
   * directly (not through the bell dropdown) without ever marking
   * `readAt`, leaving the unread badge stuck forever. Rather than
   * reimplementing that fix per notification type, every page that
   * renders a governed/financial/administrative entity directly calls
   * this once, scoped to the entity(ies) it actually rendered — see each
   * frontend call site for which relatedEntityType it uses.
   */
  async markReadForEntity(recipientUserId: string, relatedEntityType: string, relatedEntityId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { recipientUserId, relatedEntityType, relatedEntityId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}

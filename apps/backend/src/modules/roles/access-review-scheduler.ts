import { runMonitoredJob } from "../../common/jobs/job-monitor";
import { prisma } from "@birr/db";
import { NotificationsService } from "../notifications/notifications.service";
import { holdsAnyRole } from "../../common/auth/staff-roles";
import { ACCESS_REVIEW_INTERVAL_DAYS } from "./roles.service";

const DAY_MS = 24 * 60 * 60 * 1000;
/** While a review is overdue, the Board is reminded at most this often. */
const REMINDER_EVERY_DAYS = 7;

/**
 * Reminds the Board when the periodic access review is due (owner's
 * decision, 2026-11-16: every 90 days; no review yet counts as due). A
 * plain daily setInterval, like the trustee-licence check. Reminders are
 * spaced by looking at the last one sent, so there's no extra state.
 */
export function startAccessReviewScheduler(notificationsService: NotificationsService): void {
  const intervalMs = Number(process.env.ACCESS_REVIEW_CHECK_INTERVAL_MS ?? DAY_MS);
  const tick = () => {
    void runMonitoredJob("access_review_reminder", () => remindIfAccessReviewDue(notificationsService));
  };
  tick();
  setInterval(tick, intervalMs);
}

/** Returns how many Board members were reminded (0 when not due, or reminded recently). */
export async function remindIfAccessReviewDue(notificationsService: NotificationsService, now = new Date()): Promise<number> {
  const last = await prisma.accessReview.findFirst({ orderBy: { completedAt: "desc" }, select: { completedAt: true } });
  const dueAt = last ? new Date(last.completedAt.getTime() + ACCESS_REVIEW_INTERVAL_DAYS * DAY_MS) : null;
  if (dueAt && dueAt > now) return 0;

  const recent = await prisma.notification.findFirst({
    where: { type: "access_review.due", createdAt: { gte: new Date(now.getTime() - REMINDER_EVERY_DAYS * DAY_MS) } },
    select: { id: true },
  });
  if (recent) return 0;

  const board = await prisma.birrStaff.findMany({ where: { status: "active", ...holdsAnyRole("board_of_trustees") }, select: { userId: true } });
  const body = dueAt
    ? `The last access review was on ${last!.completedAt.toDateString()}. Every ${ACCESS_REVIEW_INTERVAL_DAYS} days the Board confirms each staff role's permissions are still right.`
    : `No access review has been recorded yet. Every ${ACCESS_REVIEW_INTERVAL_DAYS} days the Board confirms each staff role's permissions are still right.`;
  await Promise.all(
    board.map((member) =>
      notificationsService.notify({
        recipientType: "birr_staff",
        recipientUserId: member.userId,
        type: "access_review.due",
        title: "The access review is due",
        body,
        linkUrl: "/ops/roles?tab=reviews",
      }),
    ),
  );
  return board.length;
}

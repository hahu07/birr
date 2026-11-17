import { BirrStaffRole, prisma } from "@birr/db";
import { COUNTERPARTY_LICENSE_KIND_LABELS, LICENSE_EXPIRY_NOTICE_DAYS } from "@birr/shared";
import { runMonitoredJob } from "../../common/jobs/job-monitor";
import { holdsAnyRole } from "../../common/auth/staff-roles";
import { NotificationsService } from "../notifications/notifications.service";
import { lagosToday } from "./counterparty-licenses.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Warns whoever can verify licences (counterparty.license_verify) 60, 30
 * and 7 days before a counterparty's licence expires, and on the day it
 * lapses (2026-11-17, clinic slice 1). Each warning goes once per licence
 * (lastExpiryNoticeDays), so a licence sitting in the window doesn't
 * re-notify every day, unlike the trustee licence check. A licence already
 * replaced by a later verified one of the same kind is skipped: the
 * renewal is what matters. Daily, like the trustee licence check.
 */
export function startCounterpartyLicenseExpiryScheduler(notifications: NotificationsService): void {
  const intervalMs = Number(process.env.COUNTERPARTY_LICENSE_EXPIRY_CHECK_INTERVAL_MS ?? DAY_MS);
  const tick = () => {
    void runMonitoredJob("counterparty_license_expiry", () => sendLicenseExpiryNotices(notifications));
  };
  tick();
  setInterval(tick, intervalMs);
}

/** The warning due for a licence `daysLeft` days from expiry, or null when none is due yet. */
export function noticeDue(daysLeft: number, lastSent: number | null): number | null {
  // 0 is the lapsed notice: a licence is still in date on its expiry day.
  const due = [...LICENSE_EXPIRY_NOTICE_DAYS].sort((a, b) => a - b).find((d) => (d === 0 ? daysLeft < 0 : daysLeft <= d));
  if (due === undefined) return null;
  if (lastSent !== null && lastSent <= due) return null;
  return due;
}

export async function sendLicenseExpiryNotices(notifications: NotificationsService, today = lagosToday()): Promise<string> {
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + Math.max(...LICENSE_EXPIRY_NOTICE_DAYS) * DAY_MS);
  const candidates = await prisma.counterpartyLicense.findMany({
    where: {
      verifiedAt: { not: null },
      withdrawnAt: null,
      expiresOn: { lte: horizon },
      counterparty: { deletedAt: null, status: { not: "blacklisted" } },
    },
    include: { counterparty: { select: { id: true, name: true } } },
  });
  if (candidates.length === 0) return "No licences near expiry.";

  // Skip any licence a later verified, unwithdrawn one of the same kind replaces.
  const renewals = await prisma.counterpartyLicense.findMany({
    where: {
      counterpartyId: { in: [...new Set(candidates.map((c) => c.counterpartyId))] },
      verifiedAt: { not: null },
      withdrawnAt: null,
    },
    select: { counterpartyId: true, kind: true, expiresOn: true },
  });
  const latest = new Map<string, number>();
  for (const r of renewals) {
    const key = `${r.counterpartyId}:${r.kind}`;
    latest.set(key, Math.max(latest.get(key) ?? 0, r.expiresOn.getTime()));
  }

  const recipients = await licenseVerifiers();
  let sent = 0;
  for (const license of candidates) {
    if (latest.get(`${license.counterpartyId}:${license.kind}`)! > license.expiresOn.getTime()) continue;
    const daysLeft = Math.round((license.expiresOn.getTime() - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
    const due = noticeDue(daysLeft, license.lastExpiryNoticeDays);
    if (due === null) continue;

    // Marked first, so a failed notification isn't re-sent every day; the
    // in-app notice is best effort, like every other scheduled notice.
    const marked = await prisma.counterpartyLicense.updateMany({
      where: { id: license.id, lastExpiryNoticeDays: license.lastExpiryNoticeDays },
      data: { lastExpiryNoticeDays: due },
    });
    if (marked.count !== 1) continue;

    const label = COUNTERPARTY_LICENSE_KIND_LABELS[license.kind];
    const expiresOn = license.expiresOn.toISOString().slice(0, 10);
    const lapsed = daysLeft < 0;
    const when = daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
    const title = lapsed ? `Licence lapsed: ${license.counterparty.name}` : `Licence expires ${when}: ${license.counterparty.name}`;
    const body = lapsed
      ? `${license.counterparty.name}'s ${label} expired on ${expiresOn}. If it's a required licence, payments to them are refused until a renewal is recorded and verified.`
      : `${license.counterparty.name}'s ${label} expires on ${expiresOn}. Ask them for the renewal, then record and verify it.`;
    await Promise.all(
      recipients.map((userId) =>
        notifications.notify({
          recipientType: "birr_staff",
          recipientUserId: userId,
          type: "counterparty_license.expiring",
          title,
          body,
          linkUrl: `/ops/counterparties/${license.counterpartyId}`,
          relatedEntityType: "CounterpartyLicense",
          relatedEntityId: license.id,
        }),
      ),
    );
    sent += 1;
  }
  return `${sent} licence warning${sent === 1 ? "" : "s"} sent.`;
}

/** Active staff whose roles hold counterparty.license_verify. */
async function licenseVerifiers(): Promise<string[]> {
  const grants = await prisma.rolePermission.findMany({
    where: { permission: { key: "counterparty.license_verify" }, canMaker: true },
    select: { role: { select: { key: true } } },
  });
  const roles = grants.map((g) => g.role.key as BirrStaffRole);
  if (roles.length === 0) return [];
  const staff = await prisma.birrStaff.findMany({ where: { status: "active", ...holdsAnyRole(...roles) }, select: { userId: true } });
  return staff.map((s) => s.userId);
}

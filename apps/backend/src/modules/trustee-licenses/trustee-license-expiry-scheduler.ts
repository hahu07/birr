import { prisma } from "@birr/db";
import { NotificationsService } from "../notifications/notifications.service";

const EXPIRY_WARNING_WINDOW_DAYS = 30;

/**
 * The one Phase-B trigger point that's time-based rather than
 * event-based — nothing in the app actually causes a license to
 * expire, time just passes. Same "start simple" posture CLAUDE.md
 * calls for and services/agents' own scheduler already uses: a plain
 * setInterval, not a new scheduling dependency. Checked once at
 * startup, then on a daily-ish tick — this is the ONE place a
 * TrusteeLicense's expiresAt is ever read for a "who needs to know"
 * question, not `statusForJurisdiction()` (that's the read-time "is
 * this usable right now" check, a different question).
 *
 * Known limitation, accepted rather than engineered around for this
 * pass: there's no "already notified for this one" tracking (would
 * need a new schema field), so a license sitting in the warning window
 * without anyone updating its status gets re-notified on every tick.
 * Noisy in exchange for zero added state — reasonable for a Critical,
 * action-required item where the fix is "someone updates the license,"
 * which naturally stops the notifications once done.
 */
export function startTrusteeLicenseExpiryScheduler(notificationsService: NotificationsService): void {
  const intervalMs = Number(process.env.TRUSTEE_LICENSE_EXPIRY_CHECK_INTERVAL_MS ?? 24 * 60 * 60 * 1000);

  const tick = () => {
    checkExpiringLicenses(notificationsService).catch((err) => {
      console.error("Trustee license expiry check failed:", err);
    });
  };

  tick();
  setInterval(tick, intervalMs);
}

async function checkExpiringLicenses(notificationsService: NotificationsService): Promise<void> {
  const warningCutoff = new Date(Date.now() + EXPIRY_WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const notRequiredJurisdictions = new Set(
    (await prisma.compliancePolicySet.findMany({ where: { requiresTrusteeLicense: false }, select: { jurisdiction: true } })).map(
      (p) => p.jurisdiction,
    ),
  );

  // Filtered in JS, not the query itself — a stray license row left
  // over in a jurisdiction since marked "no license required" (see
  // CompliancePolicySet.requiresTrusteeLicense) shouldn't still page
  // admins about it.
  const licenses = (
    await prisma.trusteeLicense.findMany({
      where: { status: "active", expiresAt: { not: null, lte: warningCutoff } },
    })
  ).filter((license) => !notRequiredJurisdictions.has(license.jurisdiction));
  if (licenses.length === 0) return;

  const admins = await prisma.birrStaff.findMany({
    where: { staffRole: "platform_admin", status: "active" },
    select: { userId: true },
  });

  await Promise.all(
    licenses.map((license) => {
      const alreadyExpired = license.expiresAt! < new Date();
      const title = alreadyExpired
        ? `Trustee license expired — ${license.jurisdiction}`
        : `Trustee license expiring soon — ${license.jurisdiction}`;
      const body = alreadyExpired
        ? `Birr's trustee license in ${license.jurisdiction} expired on ${license.expiresAt!.toDateString()} and is still marked active.`
        : `Birr's trustee license in ${license.jurisdiction} expires on ${license.expiresAt!.toDateString()}.`;

      return Promise.all(
        admins.map((admin) =>
          notificationsService.notify({
            recipientType: "birr_staff",
            recipientUserId: admin.userId,
            type: "trustee_license.expiring",
            title,
            body,
            linkUrl: "/ops/jurisdictions",
            relatedEntityType: "TrusteeLicense",
            relatedEntityId: license.id,
          }),
        ),
      );
    }),
  );
}

// Ops-side Waqf governance through the real Ops Console UI — the actual
// fiduciary core CLAUDE.md is built around (asset disposal, distribution
// approval, investment changes, beneficiary-criteria changes), none of
// which approval-queue.spec.ts's own coverage touches: that spec proposes
// via a raw POST /governed-actions call and only exercises the Approval
// Queue's own maker-checker UI guard. This spec drives the OTHER half —
// a real Birr officer finding an asset on a Waqf Fund's own Ops Console
// page and clicking "Propose disposal" there — then still uses a second,
// real, independently-authenticated officer to decide it, proving the
// whole propose-then-decide path works through real UI on both ends,
// not just the decide half.
//
// asset.dispose chosen as the one concrete governed action to drive end
// to end: it's the simplest of AssetsSection/BeneficiariesSection/
// DistributionsSection/InvestmentsSection's shared ProposeGovernedActionButton
// family (a bare click, no extra staff-entered value), so this proves the
// shared component itself works for real without needing a bespoke
// per-action form.
import { test, expect, type BrowserContext } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { prisma } from "@birr/db";
import { seedStaffUser, seedWaqfWithActiveAsset } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

// Same standalone real-login-plus-MFA-enrollment helper as
// approval-queue.spec.ts's own copy — needed here too since
// e2e/auth.setup.ts's shared storageState is fixed to one role, and a
// maker-checker test genuinely needs two different, independently real
// staff identities.
async function loginAndEnrollStaff(context: BrowserContext, staffRole: string) {
  const staff = await seedStaffUser(staffRole);
  const api = context.request;

  const loginRes = await api.post(`${BACKEND_URL}/birr-staff/login`, {
    data: { email: staff.email, password: staff.password },
  });
  if (!loginRes.ok()) throw new Error(`staff login failed: ${await loginRes.text()}`);

  const enrollRes = await api.post(`${BACKEND_URL}/birr-staff/me/mfa/enroll`);
  if (!enrollRes.ok()) throw new Error(`mfa enroll failed: ${await enrollRes.text()}`);
  const { secretForManualEntry } = await enrollRes.json();

  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: secretForManualEntry });
  const confirmRes = await api.post(`${BACKEND_URL}/birr-staff/me/mfa/enroll/confirm`, {
    data: { code: totp.generate() },
  });
  if (!confirmRes.ok()) throw new Error(`mfa confirm failed: ${await confirmRes.text()}`);

  return staff;
}

test.describe("Ops Console asset disposal", () => {
  test("an officer proposes disposal from the Waqf detail page, and a second officer approves it on the queue", async ({
    browser,
  }) => {
    // mutawalli_officer: canMaker on asset.dispose. board_of_trustees:
    // canChecker, never a maker — see packages/db/prisma/seed-data.ts's
    // own rolePermissions table (same pairing approval-queue.spec.ts
    // uses for vault.publish).
    const makerContext = await browser.newContext();
    const checkerContext = await browser.newContext();

    try {
      const maker = await loginAndEnrollStaff(makerContext, "mutawalli_officer");
      const checker = await loginAndEnrollStaff(checkerContext, "board_of_trustees");
      const fixture = await seedWaqfWithActiveAsset();

      let assetId: string | undefined;
      try {
        const makerPage = await makerContext.newPage();
        await makerPage.goto(`/ops/waqfs/${fixture.waqfId}`);
        await makerPage.getByRole("tab", { name: "Assets & Impact" }).click();

        const assetRow = makerPage.locator("tr", { hasText: fixture.assetName });
        await expect(assetRow).toBeVisible();
        await assetRow.getByRole("button", { name: "Propose disposal" }).click();
        await expect(assetRow.getByText("Pending approval")).toBeVisible();

        const checkerPage = await checkerContext.newPage();
        checkerPage.on("dialog", (dialog) => dialog.accept());
        await checkerPage.goto("/ops/governed-actions");
        const queueRow = checkerPage.locator("tr", { hasText: fixture.assetName });
        await expect(queueRow).toBeVisible();
        await queueRow.getByRole("button", { name: /Dispose/ }).click();
        await queueRow.getByRole("button", { name: "Approve" }).click();
        await expect(queueRow.getByText("Approved")).toBeVisible({ timeout: 10_000 });

        const disposedAsset = await prisma.asset.findUniqueOrThrow({ where: { id: fixture.assetId } });
        assetId = disposedAsset.id;
        expect(disposedAsset.status).toBe("disposed");
        expect(disposedAsset.disposedAt).not.toBeNull();

        const decided = await prisma.governedAction.findFirstOrThrow({
          where: { permission: { key: "asset.dispose" }, payload: { path: ["assetId"], equals: fixture.assetId } },
        });
        expect(decided.status).toBe("approved");
        expect(decided.checkerUserId).toBe(checker.userId);
        expect(decided.checkerUserId).not.toBe(decided.makerUserId);

        // The propose button is gone from the real UI too, not just the
        // database — a disposed asset has nothing left to propose.
        await makerPage.reload();
        await makerPage.getByRole("tab", { name: "Assets & Impact" }).click();
        const refreshedRow = makerPage.locator("tr", { hasText: fixture.assetName });
        await expect(refreshedRow.getByRole("button", { name: "Propose disposal" })).toHaveCount(0);
      } finally {
        if (assetId) {
          await prisma.governedAction.deleteMany({
            where: { permission: { key: "asset.dispose" }, payload: { path: ["assetId"], equals: assetId } },
          });
        }
        await prisma.asset.deleteMany({ where: { id: fixture.assetId } });
        await prisma.waqf.deleteMany({ where: { id: fixture.waqfId } });
        await prisma.foundation.deleteMany({ where: { id: fixture.foundationId } });
      }

      for (const userId of [maker.userId, checker.userId]) {
        // governed-action propose/decide both fire a real
        // NotificationsService call to the other party — same FK gap
        // session-boundary.spec.ts's own cleanup hit first.
        await prisma.notification.deleteMany({ where: { recipientUserId: userId } });
        await prisma.mfaBackupCode.deleteMany({ where: { userId } });
        await prisma.birrStaff.deleteMany({ where: { userId } });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    } finally {
      await makerContext.close();
      await checkerContext.close();
    }
  });
});

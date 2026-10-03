// Ops Console governed-action approval queue — CLAUDE.md's maker-checker
// rule exercised with two REAL, independently-authenticated staff
// sessions (not a mocked "second user"), because the thing actually
// worth proving here is the individual-level guard: a human who
// proposed an action must never see Approve/Reject for it themselves,
// no matter which role they hold (see governed-actions page.tsx's own
// isOwnProposal comment). The DB-level checker_not_maker constraint is
// already covered by apps/backend/src/modules/governed-actions
// /governed-actions.service.spec.ts; what Playwright adds is the UI
// guard — the button never rendering for the maker's own browser — and
// a real second officer's click actually deciding it.
import { test, expect, type BrowserContext } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { prisma } from "@birr/db";
import { seedStaffUser, seedDraftVault } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

// A standalone real-login-plus-MFA-enrollment helper, parameterized by
// staffRole — e2e/auth.setup.ts's own version is fixed to one shared
// "mutawalli_officer" identity (reused via storageState across every
// spec file), which can't give this spec the two DIFFERENT roles
// (maker vs checker, per packages/db/prisma/seed-data.ts's own
// rolePermissions table) a maker-checker test actually needs.
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

test.describe("governed-action approval queue", () => {
  test("a maker can propose, cannot decide their own proposal, and a second officer can approve it", async ({ browser }) => {
    // mutawalli_officer: canMaker on vault.publish. board_of_trustees:
    // canChecker on vault.publish, never a maker — see seed-data.ts's
    // own rolePermissions table.
    const makerContext = await browser.newContext();
    const checkerContext = await browser.newContext();

    try {
      const maker = await loginAndEnrollStaff(makerContext, "mutawalli_officer");
      const checker = await loginAndEnrollStaff(checkerContext, "board_of_trustees");

      const vault = await seedDraftVault(maker.userId);

      const proposeRes = await makerContext.request.post(`${BACKEND_URL}/governed-actions`, {
        data: { permissionKey: "vault.publish", payload: { vaultId: vault.vaultId } },
      });
      expect(proposeRes.ok(), await proposeRes.text()).toBeTruthy();
      const action = await proposeRes.json();

      try {
        // The maker's own browser: the row renders, but as "You proposed
        // this" — Approve/Reject never appear for them, regardless of role.
        const makerPage = await makerContext.newPage();
        await makerPage.goto("/ops/governed-actions");
        const makerRow = makerPage.locator("tr", { hasText: vault.name });
        await expect(makerRow).toBeVisible();
        await expect(makerRow.getByText("You proposed this")).toBeVisible();
        await expect(makerRow.getByRole("button", { name: "Approve" })).toHaveCount(0);
        await expect(makerRow.getByRole("button", { name: "Reject" })).toHaveCount(0);

        // A second, real officer — different person, different role,
        // genuinely eligible as a checker for this permission — can see
        // and decide it. Expanding the row first is required (the
        // button stays disabled until the payload's been viewed).
        const checkerPage = await checkerContext.newPage();
        checkerPage.on("dialog", (dialog) => dialog.accept());
        await checkerPage.goto("/ops/governed-actions");
        const checkerRow = checkerPage.locator("tr", { hasText: vault.name });
        await expect(checkerRow).toBeVisible();
        await checkerRow.getByRole("button", { name: /Publish/ }).click();
        await checkerRow.getByRole("button", { name: "Approve" }).click();
        await expect(checkerRow.getByText("Approved")).toBeVisible({ timeout: 10_000 });

        const decided = await prisma.governedAction.findUniqueOrThrow({ where: { id: action.id } });
        expect(decided.status).toBe("approved");
        expect(decided.checkerUserId).toBe(checker.userId);
        expect(decided.checkerUserId).not.toBe(decided.makerUserId);

        const publishedVault = await prisma.vault.findUniqueOrThrow({ where: { id: vault.vaultId } });
        expect(publishedVault.status).toBe("open");
      } finally {
        await prisma.governedAction.deleteMany({ where: { id: action.id } });
      }

      await prisma.vault.delete({ where: { id: vault.vaultId } }).catch(() => {});
      for (const userId of [maker.userId, checker.userId]) {
        await prisma.mfaBackupCode.deleteMany({ where: { userId } });
        await prisma.birrStaff.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }
    } finally {
      await makerContext.close();
      await checkerContext.close();
    }
  });
});

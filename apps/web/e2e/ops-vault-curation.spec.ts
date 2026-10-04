// Ops Console Vault curation — the staff-side half of the Vault product
// (see schema.prisma's own "Two products, one trustee" note and
// CLAUDE.md's "Vaults are created and curated exclusively by Birr staff"
// line) that every other spec in this suite leaves untouched:
// donation-flow.spec.ts only ever exercises the donor-facing side of an
// already-published vault, and approval-queue.spec.ts proposes
// vault.publish via a raw POST rather than the real "Propose publish"
// button this spec drives instead. Scoped to curation itself — create a
// vault, add a cause, propose publishing it — not the governed decide
// half, which approval-queue.spec.ts and waqf-governance.spec.ts already
// cover for this exact maker-checker shape; repeating a second officer
// deciding it here would just be the same assertion against a different
// permissionKey.
import { test, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { prisma } from "@birr/db";
import { seedStaffUser } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

// Same standalone real-login-plus-MFA-enrollment helper as
// approval-queue.spec.ts/waqf-governance.spec.ts's own copies.
async function loginAndEnrollStaff(context: import("@playwright/test").BrowserContext, staffRole: string) {
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

test.describe("Ops Console Vault curation", () => {
  test("an officer creates a vault, adds a cause, and proposes publishing it — all through the real Ops Console", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    // Known deterministically before any UI interaction — unlike vaultId
    // below (only assigned after a real navigation succeeds), this is
    // always available to the cleanup in `finally`, even if the test
    // fails before that navigation ever completes (found live: a first-
    // visit Turbopack compile delay once left a real Vault+User pair
    // behind because vaultId was still undefined at that point).
    const vaultName = `E2E Ops Vault ${Date.now()}`;
    let vaultId: string | undefined;

    try {
      const staff = await loginAndEnrollStaff(context, "mutawalli_officer");
      const slug = `e2e-ops-vault-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const causeName = `E2E Ops Cause ${Date.now()}`;

      const page = await context.newPage();
      await page.goto("/ops/vaults");

      await page.getByRole("button", { name: "Create vault" }).click();
      await page.getByPlaceholder("Ramadan Relief").fill(vaultName);
      await page.getByPlaceholder("ramadan-relief-2026").fill(slug);
      // exact: true — "Additional currencies"'s own placeholder
      // ("e.g. NGN, USDC") also contains the substring "NG".
      await page.getByPlaceholder("NG", { exact: true }).fill("NG");
      await page.getByRole("button", { name: "Create" }).click();

      // onCreated() just hides the form and reloads the list in place —
      // no navigation of its own, so the new row has to actually appear
      // in the real table before following its link.
      const vaultLink = page.getByRole("link", { name: vaultName });
      await expect(vaultLink).toBeVisible({ timeout: 10_000 });
      // /ops/vaults/[id] is a dynamic route this run hasn't visited yet
      // — Turbopack compiles each route lazily on its first hit, which
      // can comfortably exceed the default 5s expect timeout (same gap
      // playwright.config.ts's own comment on this exact class of
      // flake flags) — wait for the real navigation first, generously,
      // rather than racing a plain visibility check against a cold
      // compile.
      await Promise.all([
        page.waitForURL(/\/ops\/vaults\/[^/]+$/, { timeout: 20_000 }),
        vaultLink.click(),
      ]);

      vaultId = new URL(page.url()).pathname.split("/").pop();
      await expect(page.getByRole("heading", { name: vaultName })).toBeVisible({ timeout: 20_000 });
      // exact: true — VaultDistributionsSection's own copy elsewhere on
      // this page ("Draft payouts to a relief/delivery partner…") also
      // contains the substring "Draft".
      await expect(page.getByText("Draft", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Add causes" }).click();
      await page.getByRole("button", { name: "Add a custom cause" }).click();
      // The Name field has no <label htmlFor>/id pairing and no
      // placeholder (see VaultCausesSection.tsx's own CustomCauseForm) —
      // but it's a real autoFocus input, so typing straight after
      // opening this form exercises that real behavior instead of
      // reaching for a brittle structural selector.
      await page.keyboard.type(causeName);
      await page.getByRole("button", { name: "Add", exact: true }).click();

      const causeRow = page.locator("tr", { hasText: causeName });
      await expect(causeRow).toBeVisible({ timeout: 10_000 });

      await page.getByRole("button", { name: "Propose publish" }).click();
      await expect(page.getByText("Pending approval")).toBeVisible();

      const action = await prisma.governedAction.findFirstOrThrow({
        where: { permission: { key: "vault.publish" }, payload: { path: ["vaultId"], equals: vaultId } },
      });
      expect(action.status).toBe("proposed");
      expect(action.makerUserId).toBe(staff.userId);

      const vault = await prisma.vault.findUniqueOrThrow({ where: { id: vaultId } });
      expect(vault.status).toBe("draft");
      expect(vault.name).toBe(vaultName);
    } finally {
      // By name, not the locally-captured vaultId — robust against the
      // test failing before that variable ever gets assigned (see its
      // own comment above), since the real Vault row still exists
      // either way once the create-vault form was submitted.
      const created = await prisma.vault.findFirst({ where: { name: vaultName } });
      if (created) {
        await prisma.governedAction.deleteMany({
          where: { permission: { key: "vault.publish" }, payload: { path: ["vaultId"], equals: created.id } },
        });
        await prisma.vaultCause.deleteMany({ where: { vaultId: created.id } });
        await prisma.vault.deleteMany({ where: { id: created.id } });
      }
      await context.close();
    }
  });
});

test.afterEach(async () => {
  await prisma.notification.deleteMany({ where: { recipientUser: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.mfaBackupCode.deleteMany({ where: { user: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.birrStaff.deleteMany({ where: { user: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-staff-" } } });
});

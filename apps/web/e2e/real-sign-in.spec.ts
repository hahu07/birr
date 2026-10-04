// The actual sign-in forms — every other spec in this suite authenticates
// via direct HTTP calls (auth.setup.ts's own storageState pattern, and
// every maker-checker spec's loginAndEnrollStaff helper), which is the
// right call for those specs' own purposes (CLAUDE.md's "two products,
// two different auth surfaces" split needs a full, independent staff
// identity per test, not a shared cached session) but means the real
// /sign-in and /ops/sign-in *pages* — including the real password-then-
// MFA-code two-step flow and its wrong-password/wrong-code error states —
// have never actually been driven through a browser anywhere in this
// suite. This spec is that: real forms, real typed credentials, real
// redirects.
//
// Founder MFA is opt-in (most founders never enroll — see (founder)/
// sign-in/page.tsx's own comment), so the founder side here only covers
// the password-only path, the realistic common case. Birr staff MFA is
// mandatory, so the staff side covers the full two-step challenge too.
//
// Deliberately scoped to 3 total real /birr-staff/login attempts (1 to
// trigger enrollment, 1 for the real TOTP sign-in, 1 for the wrong-
// password case against a never-enrolled fixture) rather than 6 — that
// endpoint's own @Throttle({limit: 10, ttl: 600_000}) is shared across
// every spec file in this suite within a single run (approval-queue.spec.ts
// and waqf-governance.spec.ts alone already spend 4 of it on their own
// maker/checker logins), and a backup-code scenario here would have
// pushed the suite's own real-world total past that limit. Left as
// follow-on coverage once there's headroom to spend on it, rather than
// built now and left intermittently throttled.
import { test, expect, type Browser } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { prisma } from "@birr/db";
import { seedStaffUser, seedEstablishedFounder } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

/**
 * Enrolls a staff member's MFA via real HTTP, in a throwaway context
 * that's discarded immediately — so the actual test gets a completely
 * cookie-free browser context afterward and has to drive the real
 * sign-in form from scratch, exactly like a staff member returning on a
 * new device/browser would, rather than inheriting an already-signed-in
 * session from setup.
 */
async function seedMfaEnrolledStaff(browser: Browser, staffRole: string) {
  const staff = await seedStaffUser(staffRole);
  const setupContext = await browser.newContext();
  try {
    const api = setupContext.request;
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
    const { backupCodes } = await confirmRes.json();

    return { ...staff, secretForManualEntry, backupCodes: backupCodes as string[] };
  } finally {
    await setupContext.close();
  }
}

test.describe("Founder Portal sign-in", () => {
  test("a founder signs in with the real form and reaches the dashboard", async ({ page }) => {
    const founder = await seedEstablishedFounder();

    await page.goto("/sign-in");
    await page.getByLabel("Username or email").fill(founder.email);
    await page.getByLabel("Password", { exact: true }).fill(founder.password);

    await Promise.all([page.waitForURL("/", { timeout: 10_000 }), page.getByRole("button", { name: "Sign in" }).click()]);

    await expect(page.getByText("E2E Fixture Founder")).toBeVisible({ timeout: 10_000 });
  });

  test("a wrong password shows a real error and never signs in", async ({ page }) => {
    const founder = await seedEstablishedFounder();

    await page.goto("/sign-in");
    await page.getByLabel("Username or email").fill(founder.email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Couldn't sign in")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in$/);
    const cookies = await page.context().cookies();
    expect(cookies.some((c) => c.name === "birr_session")).toBe(false);
  });
});

test.describe("Ops Console sign-in", () => {
  test("a staff member signs in with password then a real authenticator code", async ({ page, browser }) => {
    const staff = await seedMfaEnrolledStaff(browser, "mutawalli_officer");

    await page.goto("/ops/sign-in");
    await page.getByLabel("Email").fill(staff.email);
    await page.getByLabel("Password", { exact: true }).fill(staff.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Two-factor verification" })).toBeVisible();

    const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: staff.secretForManualEntry });
    await page.getByLabel("Authentication code").fill(totp.generate());

    await Promise.all([
      page.waitForURL("/ops", { timeout: 10_000 }),
      page.getByRole("button", { name: "Verify" }).click(),
    ]);

    await expect(page.getByText("E2E Fixture Staff")).toBeVisible({ timeout: 10_000 });
  });

  test("a wrong password shows a real error and never reaches the MFA step", async ({ page }) => {
    // seedStaffUser(), not seedMfaEnrolledStaff() — login rejects a
    // wrong password before it ever checks mfaEnabled, so this scenario
    // doesn't need (and, per this file's own throttle-budget comment,
    // can't afford) a real enrollment round trip just to prove that.
    const staff = await seedStaffUser("mutawalli_officer");

    await page.goto("/ops/sign-in");
    await page.getByLabel("Email").fill(staff.email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Couldn't sign in")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Two-factor verification" })).not.toBeVisible();
    await expect(page).toHaveURL(/\/ops\/sign-in$/);
  });
});

test.afterEach(async () => {
  await prisma.notification.deleteMany({ where: { recipientUser: { email: { startsWith: "e2e-founder-" } } } });
  await prisma.founderMembership.deleteMany({
    where: { user: { email: { startsWith: "e2e-founder-" }, signedFoundationDeeds: { none: {} } } },
  });
  await prisma.foundationFounder.deleteMany({
    where: { founder: { name: "E2E Fixture Founder Org", signedFoundationDeeds: { none: {} } } },
  });
  await prisma.foundation.deleteMany({
    where: { name: { startsWith: "E2E Fixture Foundation " }, foundationDeed: null },
  });
  await prisma.founder.deleteMany({
    where: { name: "E2E Fixture Founder Org", signedFoundationDeeds: { none: {} } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "e2e-founder-" }, signedFoundationDeeds: { none: {} } },
  });

  await prisma.notification.deleteMany({ where: { recipientUser: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.mfaBackupCode.deleteMany({ where: { user: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.birrStaff.deleteMany({ where: { user: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-staff-" } } });
});

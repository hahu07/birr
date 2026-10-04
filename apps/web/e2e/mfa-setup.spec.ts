// The forced MFA enrollment screen itself — every other spec in this
// suite (including real-sign-in.spec.ts, which drives real *login*
// through the browser) enrolls MFA via raw HTTP in a throwaway setup
// step, never through this actual page. This drives the real QR-code/
// manual-secret screen: extracts the real TOTP secret the page itself
// renders, computes a real code from it (same as every other spec's own
// otpauth usage, just reading the secret from the DOM instead of an API
// response), and confirms enrollment for real — plus the app-shell
// enforcement gate that gets a not-yet-enrolled staff member here in the
// first place (see ops/app-shell.tsx's own MFA_EXEMPT_ROUTES comment:
// every other /ops route redirects here until mfaEnabled is true).
import { test, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { prisma } from "@birr/db";
import { seedStaffUser } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

async function loginStaffWithoutMfa(context: import("@playwright/test").BrowserContext, staffRole: string) {
  const staff = await seedStaffUser(staffRole);
  const loginRes = await context.request.post(`${BACKEND_URL}/birr-staff/login`, {
    data: { email: staff.email, password: staff.password },
  });
  if (!loginRes.ok()) throw new Error(`staff login failed: ${await loginRes.text()}`);
  const body = await loginRes.json();
  // mfaEnabled is false on a fresh seedStaffUser() fixture — login grants
  // a real session immediately, no MFA challenge yet. That's exactly the
  // "signed in, not yet enrolled" state this whole spec is about.
  if (body.mfaRequired) throw new Error("fixture staff unexpectedly already has MFA enrolled");
  return staff;
}

async function readRenderedSecret(page: import("@playwright/test").Page): Promise<string> {
  // The page's own useEffect calls POST /birr-staff/me/mfa/enroll on
  // mount and renders secretForManualEntry directly — no separate API
  // call needed here, just reading what a real staff member scanning
  // the QR code would see. Base32 alphabet (A-Z, 2-7) is distinctive
  // enough to isolate it from surrounding copy without relying on a
  // CSS class that could change.
  const secretParagraph = page.locator("p").filter({ hasText: /^[A-Z2-7]{16,}$/ }).first();
  await expect(secretParagraph).toBeVisible({ timeout: 10_000 });
  const secret = (await secretParagraph.textContent())?.trim();
  if (!secret) throw new Error("couldn't read the rendered MFA secret");
  return secret;
}

test.describe("Staff MFA enrollment", () => {
  test("a staff member without MFA is redirected to setup, enrolls with a real code, and reaches the Ops Console", async ({
    page,
    context,
  }) => {
    const staff = await loginStaffWithoutMfa(context, "mutawalli_officer");

    // Any other /ops route bounces here — see ops/app-shell.tsx's own
    // MFA_EXEMPT_ROUTES comment. Visiting "/ops" directly (not
    // /ops/mfa-setup) proves the enforcement gate itself, not just that
    // the setup page works when visited on its own.
    await page.goto("/ops");
    await page.waitForURL("/ops/mfa-setup", { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Set up two-factor authentication" })).toBeVisible({
      timeout: 10_000,
    });

    const secret = await readRenderedSecret(page);
    const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret });
    await page.getByLabel("Enter the 6-digit code from your app").fill(totp.generate());
    await page.getByRole("button", { name: "Confirm and enable" }).click();

    await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible({ timeout: 10_000 });
    const backupCodes = await page.locator(".grid.grid-cols-2 span").allTextContents();
    expect(backupCodes).toHaveLength(10);
    expect(new Set(backupCodes).size).toBe(10); // all distinct

    await Promise.all([
      page.waitForURL("/ops", { timeout: 10_000 }),
      page.getByRole("button", { name: "I've saved these — continue to Ops Console" }).click(),
    ]);
    await expect(page.getByText("E2E Fixture Staff")).toBeVisible({ timeout: 10_000 });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: staff.userId } });
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecretEncrypted).toBeTruthy();
    expect(await prisma.mfaBackupCode.count({ where: { userId: staff.userId } })).toBe(10);
  });

  test("an incorrect confirmation code shows a real error and never enables MFA", async ({ page, context }) => {
    const staff = await loginStaffWithoutMfa(context, "mutawalli_officer");

    await page.goto("/ops/mfa-setup");
    await expect(page.getByRole("heading", { name: "Set up two-factor authentication" })).toBeVisible({
      timeout: 10_000,
    });
    await readRenderedSecret(page); // confirms the real secret rendered before trying a deliberately wrong code

    await page.getByLabel("Enter the 6-digit code from your app").fill("000000");
    await page.getByRole("button", { name: "Confirm and enable" }).click();

    await expect(page.getByText("Couldn't confirm")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Save your backup codes" })).not.toBeVisible();
    await expect(page).toHaveURL(/\/ops\/mfa-setup$/);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: staff.userId } });
    expect(user.mfaEnabled).toBe(false);
  });
});

test.afterEach(async () => {
  await prisma.notification.deleteMany({ where: { recipientUser: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.mfaBackupCode.deleteMany({ where: { user: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.birrStaff.deleteMany({ where: { user: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-staff-" } } });
});

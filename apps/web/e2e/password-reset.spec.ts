// Self-service password recovery — /forgot-password and /reset-password
// (found missing entirely during a 2026-09-14 comprehensive Founder-side
// review; see forgot-password/page.tsx's own comment). Real two-step
// flow: request a reset link (POST /founders/request-password-reset,
// which always returns {ok: true} and shows the same "check your email"
// copy whether or not the address has a real account — an anti-
// enumeration design this spec specifically proves holds), then follow
// it with the real, DB-issued token (User.passwordResetToken — the same
// pattern founder-establishment.spec.ts already uses for email
// verification's own token) to actually change the password.
//
// Both endpoints sit on their own separate @Throttle(5 per 10 min)
// buckets (confirmed against the controller directly — distinct from
// /founders/login's own bucket, which real-sign-in.spec.ts and others
// already spend from), so this file deliberately makes just one real
// /founders/login call, to prove the new password actually works end to
// end, not to re-test login itself.
import { test, expect } from "@playwright/test";
import { prisma } from "@birr/db";
import { seedEstablishedFounder } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

test.describe("Password reset", () => {
  test("a founder resets their password through the real two-step flow and can sign in with the new one", async ({
    page,
    context,
  }) => {
    const founder = await seedEstablishedFounder();
    const newPassword = "E2e-Reset-New-Password-2!";

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(founder.email);
    await page.getByRole("button", { name: "Send reset link" }).click();

    // requestPasswordReset() awaits a real outbound Resend API call
    // before responding when the email matches a real account (see
    // founders.service.ts's own try/catch around sendPasswordResetEmail)
    // — slower than the default 5s expect timeout, same class of delay
    // as this suite's other real-outbound-call assertions.
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(founder.email)).toBeVisible();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: founder.userId } });
    expect(user.passwordResetToken).toBeTruthy();

    await page.goto(`/reset-password?token=${user.passwordResetToken}`);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByRole("heading", { name: "Password reset" })).toBeVisible();

    // The token is single-use and the new password actually works — not
    // just that the UI showed a success message.
    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: founder.userId } });
    expect(updatedUser.passwordResetToken).toBeNull();
    expect(updatedUser.passwordHash).not.toBe(user.passwordHash);

    const loginRes = await context.request.post(`${BACKEND_URL}/founders/login`, {
      data: { username: founder.email, password: newPassword },
    });
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
  });

  test("requesting a reset for an unregistered email shows the same confirmation, never revealing whether an account exists", async ({
    page,
  }) => {
    const unregisteredEmail = `e2e-no-such-founder-${Date.now()}@e2e.birr.test`;

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(unregisteredEmail);
    await page.getByRole("button", { name: "Send reset link" }).click();

    // Same heading, same template, same email echoed back — no distinct
    // "no account found" branch exists anywhere in this flow.
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText(unregisteredEmail)).toBeVisible();
  });

  test("an invalid token shows a real error, not a silent success", async ({ page }) => {
    await page.goto("/reset-password?token=this-token-does-not-exist");
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

    await page.getByLabel("New password", { exact: true }).fill("E2e-Reset-Attempt-Password-1!");
    await page.getByLabel("Confirm new password").fill("E2e-Reset-Attempt-Password-1!");
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByText("Couldn't reset password")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Password reset" })).not.toBeVisible();
  });

  test("visiting the reset page with no token shows the missing-link state", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Missing reset link" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link →" })).toBeVisible();
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
});

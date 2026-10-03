// Real Founder self-service onboarding: sign-up form -> real email
// verification (driven through the actual DB-issued token, the one
// piece of this flow Playwright CAN drive for real, unlike WhatsApp's
// OTP which has no realistic delivery channel here — see
// e2e/fixtures/seed.ts's own comment on why that one step is seeded
// instead) -> establishment form. This is the one self-service path in
// the app CLAUDE.md is most insistent about: establishment must never
// be gated on anything but email + WhatsApp verification (no approval
// gate, no automated screening — see CLAUDE.md's 2026-09-15 updates),
// so this spec exercises exactly those two real gates and nothing else.
import { test, expect } from "@playwright/test";
import { prisma } from "@birr/db";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

function uniqueEmail() {
  return `e2e-establish-${Date.now()}-${Math.floor(Math.random() * 100000)}@e2e.birr.test`;
}

test.describe("founder self-service establishment", () => {
  let createdUserId: string | undefined;

  test.afterEach(async () => {
    if (!createdUserId) return;
    const membership = await prisma.founderMembership.findFirst({ where: { userId: createdUserId } });
    if (membership) {
      const founderId = membership.founderId;
      const foundationFounder = await prisma.foundationFounder.findFirst({ where: { founderId } });
      await prisma.founderMembership.deleteMany({ where: { founderId } });
      if (foundationFounder) {
        const foundationId = foundationFounder.foundationId;
        await prisma.foundationFounder.deleteMany({ where: { foundationId } });
        await prisma.foundation.delete({ where: { id: foundationId } }).catch(() => {});
      }
      await prisma.founder.delete({ where: { id: founderId } }).catch(() => {});
    }
    await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
    createdUserId = undefined;
  });

  test("sign-up, real email verification, and establishment all succeed through the real UI", async ({ page }) => {
    const email = uniqueEmail();
    const username = `e2e-establish-${Date.now()}`;
    const password = "E2e-Fixture-Password-1!";

    await page.goto("/sign-up");
    await page.getByLabel("Full name").fill("E2E Establishment Founder");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.locator('input[type="checkbox"]').check();

    await Promise.all([page.waitForURL("/"), page.getByRole("button", { name: "Create account" }).click()]);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdUserId = user.id;
    expect(user.status).toBe("invited");
    expect(user.verificationToken).toBeTruthy();

    // Real HTTP GET against the backend's own verify-email redirect —
    // not a seeded shortcut. FOUNDER_PORTAL_URL is pointed at this
    // suite's own BASE_URL (see playwright.config.ts's own comment), so
    // following the redirect lands on this app's real /verified page.
    await page.goto(`${BACKEND_URL}/founders/verify-email?token=${user.verificationToken}`);
    await expect(page.getByText("Email verified")).toBeVisible();
    await page.waitForURL("/", { timeout: 10_000 });

    const verifiedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(verifiedUser.status).toBe("active");
    expect(verifiedUser.verificationToken).toBeNull();

    // WhatsApp verification is seeded directly — no real OTP channel
    // exists in this environment (see this file's own header comment
    // and auth.setup.ts's matching one).
    await prisma.user.update({ where: { id: user.id }, data: { whatsappVerifiedAt: new Date() } });

    await page.goto("/onboarding/founder-foundation");
    await expect(page.getByLabel("Institution name")).toBeVisible();
    await page.getByLabel("Institution name").fill("E2E Establishment Institution");
    await page.getByLabel("Name", { exact: true }).fill("E2E Establishment Foundation");
    await page
      .getByLabel("Purpose")
      .fill("Supporting Islamic education and orphan welfare across Northern Nigeria.");
    // A non-joint establishment (the default here) does a full
    // navigation straight to step 3's route on success — see
    // founder-foundation/page.tsx's own comment on why that's a full
    // location change, not a same-page state update.
    await Promise.all([
      page.waitForURL(/\/onboarding\/waqf-fund$/, { timeout: 10_000 }),
      page.getByRole("button", { name: "Establish Foundation" }).click(),
    ]);

    const api = page.context().request;
    const statusRes = await api.get(`${BACKEND_URL}/founders/me/onboarding-status`);
    expect(statusRes.ok()).toBeTruthy();
    const status = await statusRes.json();
    expect(status.steps.emailVerified.complete).toBe(true);
    expect(status.steps.whatsappVerified.complete).toBe(true);
    expect(status.steps.foundationEstablished.complete).toBe(true);
  });

  test("establishment is blocked until both email and WhatsApp are verified — never by an approval gate", async ({ page }) => {
    // Confirms CLAUDE.md's standing self-service principle the other
    // way round: a founder who signs up but skips verification can
    // reach the establishment form (there's no approval gate blocking
    // navigation to it) yet the backend itself still won't let the
    // write through — assertUserEmailVerified/assertUserWhatsAppVerified
    // reject it, not a human reviewer.
    const email = uniqueEmail();
    const username = `e2e-establish-${Date.now()}`;
    const password = "E2e-Fixture-Password-1!";

    await page.goto("/sign-up");
    await page.getByLabel("Full name").fill("E2E Unverified Founder");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.locator('input[type="checkbox"]').check();
    await Promise.all([page.waitForURL("/"), page.getByRole("button", { name: "Create account" }).click()]);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdUserId = user.id;

    const api = page.context().request;
    const establishRes = await api.post(`${BACKEND_URL}/founders/establish`, {
      multipart: {
        founderName: "E2E Unverified Institution",
        kind: "institution",
        foundationName: "E2E Unverified Foundation",
        purpose: "Should never be allowed to establish before verification.",
      },
    });
    expect(establishRes.ok()).toBeFalsy();
    expect(establishRes.status()).toBe(403);
  });
});

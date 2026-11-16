// Co-founder invitation acceptance — the one remaining real self-service
// gap: founder-foundation/page.tsx's own joint-establishment flow (and a
// Foundation's own detail page, for inviting one later) can only ever
// SEND a co_founder invite; nothing in this suite has ever driven the
// other half, a real person clicking that link and actually joining.
// Real end to end: an already-established founder sends a real
// invitation (POST /invitations, using their own real session — not
// seeded), then a completely fresh, cookie-less browser context (a
// different person, a different device) accepts it through the real
// /ops/accept-invitation form — @Public() by design, the token itself is
// the credential (see InvitationsController's own comment).
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { prisma } from "@birr/db";
import { seedEstablishedFounder } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

function uniqueEmail() {
  return `e2e-cofounder-${Date.now()}-${Math.floor(Math.random() * 100000)}@e2e.birr.test`;
}

// A standalone APIRequestContext, not a browser context — this is pure
// HTTP setup (the inviting founder sending the invite), never a UI
// concern under test, and its own cookie jar automatically carries the
// login response's session cookie onto the following /invitations call
// without any manual header plumbing.
async function sendCoFounderInvite(founder: { email: string; password: string; foundationId: string }) {
  const api = await playwrightRequest.newContext();
  try {
    const loginRes = await api.post(`${BACKEND_URL}/founders/login`, {
      data: { username: founder.email, password: founder.password },
    });
    if (!loginRes.ok()) throw new Error(`inviter login failed: ${await loginRes.text()}`);

    const email = uniqueEmail();
    const inviteRes = await api.post(`${BACKEND_URL}/invitations`, {
      data: { inviteeKind: "co_founder", email, foundationId: founder.foundationId },
    });
    if (!inviteRes.ok()) throw new Error(`invite send failed: ${await inviteRes.text()}`);
    const invitation = await inviteRes.json();
    return { email, token: invitation.token as string };
  } finally {
    await api.dispose();
  }
}

test.describe("Co-founder invitation", () => {
  test("a fresh person accepts a real invitation and joins the Foundation as a co-founder", async ({ browser }) => {
    const founder = await seedEstablishedFounder();
    const { email: coFounderEmail, token } = await sendCoFounderInvite(founder);

    // A completely fresh, cookie-less context — the invitee has no
    // relationship to the inviter's own browser/session at all.
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`/ops/accept-invitation?token=${token}&kind=co_founder`);
      await expect(page.getByRole("heading", { name: /^Join .+ as a co-founder$/ })).toBeVisible();

      // Joining for an organization; the page defaults to an individual.
      await page.getByRole("radio", { name: /^Institution/ }).check();
      await page.getByLabel("Institution name").fill("E2E Co-Founder Institution");
      await page.getByLabel("Full name").fill("E2E Co-Founder Person");
      // exact: true — PasswordInput's own "Show password" toggle button
      // has an aria-label containing the substring "password", and
      // "Confirm password" itself contains "password" too.
      await page.getByLabel("Password", { exact: true }).fill("E2e-CoFounder-Password-1!");
      await page.getByLabel("Confirm password").fill("E2e-CoFounder-Password-1!");
      // Joining needs the co-founder's own agreement to the Foundation's deed.
      await page.getByRole("checkbox", { name: /I accept this statement/ }).check();

      // The page's own success handler always does window.location.href
      // = "/" first — but this brand-new co-founder's own Foundation has
      // no funded Waqf yet (seedEstablishedFounder() never creates one),
      // so app-shell's onboarding gate immediately continues on to
      // /onboarding/waqf-fund (step 3) right behind it, a real,
      // deterministic double-redirect, not a bug. Waiting for navigation
      // away from the invite page (rather than a specific destination)
      // tolerates landing on either, whichever this run's timing catches.
      await Promise.all([
        page.waitForURL((url) => !url.pathname.startsWith("/ops/accept-invitation"), { timeout: 10_000 }),
        page.getByRole("button", { name: "Accept and join as co-founder" }).click(),
      ]);

      const newUser = await prisma.user.findUniqueOrThrow({ where: { email: coFounderEmail } });
      expect(newUser.fullName).toBe("E2E Co-Founder Person");

      const newMembership = await prisma.founderMembership.findFirstOrThrow({ where: { userId: newUser.id } });
      expect(newMembership.permissionLevel).toBe("primary_contact");
      expect(newMembership.founderId).not.toBe(founder.founderId);

      const newFounder = await prisma.founder.findUniqueOrThrow({ where: { id: newMembership.founderId } });
      expect(newFounder.name).toBe("E2E Co-Founder Institution");

      // Both founders are now attached to the SAME Foundation — the
      // actual point of "co-founder," proven at the DB level, not just
      // that a new account exists.
      const joint = await prisma.foundationFounder.findUniqueOrThrow({
        where: { foundationId_founderId: { foundationId: founder.foundationId, founderId: newMembership.founderId } },
      });
      expect(joint.foundationId).toBe(founder.foundationId);

      const accepted = await prisma.invitation.findUniqueOrThrow({ where: { token } });
      expect(accepted.status).toBe("accepted");
    } finally {
      await context.close();
    }
  });

  test("accepting the same invitation link twice fails the second time, not a duplicate account", async ({
    browser,
  }) => {
    const founder = await seedEstablishedFounder();
    const { token } = await sendCoFounderInvite(founder);

    const firstContext = await browser.newContext();
    try {
      const firstPage = await firstContext.newPage();
      await firstPage.goto(`/ops/accept-invitation?token=${token}&kind=co_founder`);
      await firstPage.getByRole("radio", { name: /^Institution/ }).check();
      await firstPage.getByLabel("Institution name").fill("E2E Co-Founder Institution 2");
      await firstPage.getByLabel("Full name").fill("E2E Co-Founder Person 2");
      await firstPage.getByLabel("Password", { exact: true }).fill("E2e-CoFounder-Password-2!");
      await firstPage.getByLabel("Confirm password").fill("E2e-CoFounder-Password-2!");
      await firstPage.getByRole("checkbox", { name: /I accept this statement/ }).check();
      await Promise.all([
        firstPage.waitForURL("/", { timeout: 10_000 }),
        firstPage.getByRole("button", { name: "Accept and join as co-founder" }).click(),
      ]);
    } finally {
      await firstContext.close();
    }

    const secondContext = await browser.newContext();
    try {
      const secondPage = await secondContext.newPage();
      await secondPage.goto(`/ops/accept-invitation?token=${token}&kind=co_founder`);
      // A used link reveals nothing and offers no form to fill in again.
      await expect(secondPage.getByText("This invitation isn't valid anymore")).toBeVisible();
      await expect(secondPage.getByRole("button", { name: "Accept and join as co-founder" })).toHaveCount(0);
      expect(await prisma.user.count({ where: { email: (await prisma.invitation.findUniqueOrThrow({ where: { token } })).email } })).toBe(1);
    } finally {
      await secondContext.close();
    }
  });
});

// Only what isn't part of the record. The fixture people, Founders and
// Foundations stay: the audit log names them and each co-founder's
// agreement to the deed (co_founder_deed_consents) is immutable, so like
// every other spec since 2026-11-15, tests leave them in place.
test.afterEach(async () => {
  await prisma.notification.deleteMany({
    where: { recipientUser: { email: { startsWith: "e2e-founder-" } } },
  });
  await prisma.notification.deleteMany({
    where: { recipientUser: { email: { startsWith: "e2e-cofounder-" } } },
  });
});

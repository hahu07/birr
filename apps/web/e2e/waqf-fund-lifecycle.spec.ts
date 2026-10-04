// The Waqf Fund self-service lifecycle — the other half of CLAUDE.md's
// "two products, one trustee" picture that donation-flow.spec.ts's own
// Vault coverage doesn't touch at all. Establishing a *Foundation* is
// already covered by founder-establishment.spec.ts; this covers what
// happens next — creating a Waqf Fund under it (step 3 of onboarding)
// and signing the Foundation Deed (step 4) — through the real onboarding
// wizard pages, not just URL-matched in passing.
//
// Both steps end in a real external payment/legal act this suite can't
// drive for real: a Waqf Fund's first contribution needs a real Paystack/
// stablecoin checkout (no test credentials exist in this environment —
// same reasoning as donation-flow.spec.ts's own contribution mocking),
// and the deed-signing step itself only becomes reachable once a Waqf
// Fund is genuinely active, which normally only happens once that
// payment confirms via webhook. Both are therefore scoped the same way:
// seed/mock the one external dependency, drive everything else — the
// real form, the real validation, the real onboarding gate — for real.
import { test, expect } from "@playwright/test";
import { prisma } from "@birr/db";
import { seedEstablishedFounder, seedActiveWaqf } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

async function loginAsFounder(context: import("@playwright/test").BrowserContext, email: string, password: string) {
  const loginRes = await context.request.post(`${BACKEND_URL}/founders/login`, {
    data: { username: email, password },
  });
  expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
}

test.describe("Waqf Fund establishment", () => {
  test("a founder reaches checkout after establishing their first Waqf Fund", async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const founder = await seedEstablishedFounder();
      await loginAsFounder(context, founder.email, founder.password);
      // A relative, same-origin path, not a real external domain like
      // checkout.paystack.com — a live third-party domain isn't
      // guaranteed reachable from this sandbox (observed: an
      // intermittent browser-level network error instead of a real
      // navigation). Next.js renders its own 404 here, still a real,
      // successful same-origin navigation — enough to prove
      // window.location.href actually fired with the backend's
      // returned checkoutUrl.
      const checkoutUrl = "/e2e-fixture-checkout";

      const page = await context.newPage();
      await page.route("**/contributions", (route) => {
        if (route.request().method() !== "POST") return route.continue();
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ clientPayload: { checkoutUrl } }),
        });
      });

      await page.goto("/onboarding/waqf-fund");
      await expect(page.getByRole("heading", { name: "Establish your first Waqf Fund" })).toBeVisible();

      await page.getByLabel("Name").fill("E2E Fixture Scholarship Fund");
      await page.getByLabel("Jurisdiction").fill("NG");
      // Above packages/db/prisma/seed-data.ts's own NGN corpusMinimum
      // (1,500,000) — the lump-sum "Amount" field auto-fills to match
      // this and is read-only, so nothing else needs filling in.
      await page.getByLabel(/Corpus amount/).fill("2000000");

      await Promise.all([
        page.waitForURL(checkoutUrl, { timeout: 10_000 }),
        page.getByRole("button", { name: "Continue to payment" }).click(),
      ]);

      await expect(page).toHaveURL(checkoutUrl);

      const statusRes = await context.request.get(`${BACKEND_URL}/founders/me/onboarding-status`);
      const status = await statusRes.json();
      // Still step 3 — POST /contributions was mocked, so no real
      // payment ever confirmed and the waqf never left `draft`. This is
      // the honest state a real founder would also be in immediately
      // after being redirected to checkout, before paying.
      expect(status.steps.foundationEstablished.complete).toBe(true);
      expect(status.steps.firstWaqfFunded.complete).toBe(false);
    } finally {
      await context.close();
    }
  });

  test.afterEach(async () => {
    // No FoundationDeed created by THIS describe block — but
    // "E2E Fixture Foundation "/"e2e-founder-" is the same shared prefix
    // every seedEstablishedFounder()-based spec uses, including this
    // file's own "Foundation Deed signing" block below, whose fixture
    // Foundation/Founder/User are deliberately permanent (see that
    // block's own afterEach comment). A plain prefix match here would
    // try, and fail, to delete those too — `foundationDeed: null` /
    // `signedFoundationDeeds: { none: {} }` scopes every delete to rows
    // with no deed, i.e. only ever this block's own fixtures.
    await prisma.notification.deleteMany({ where: { recipientUser: { email: { startsWith: "e2e-founder-" } } } });
    await prisma.waqf.deleteMany({
      where: { foundation: { name: { startsWith: "E2E Fixture Foundation " }, foundationDeed: null } },
    });
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
});

test.describe("Foundation Deed signing", () => {
  test("a founder can sign the deed once their first Waqf Fund is active", async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const founder = await seedEstablishedFounder();
      const waqf = await seedActiveWaqf(founder.foundationId);
      await loginAsFounder(context, founder.email, founder.password);

      const page = await context.newPage();
      await page.goto("/onboarding/deed");
      await expect(page.getByRole("heading", { name: "Sign the waqf deed" })).toBeVisible();
      await expect(page.getByText(waqf.name)).toBeVisible();

      await page.getByLabel("Type your full legal name to sign").fill("E2E Fixture Founder");
      await page.getByRole("checkbox").check();

      // onSigned is window.location.reload() on this page (unlike
      // foundations/[id]/deed/page.tsx's in-place refetch) — once that
      // reload sees onboarding fully complete, app-shell's own gate
      // immediately routes away from every /onboarding/* path (see its
      // "else if (isOnboardingRoute(pathname))" branch), landing on "/".
      // There's no inline "deed signed" state to see on this page itself
      // — the real proof is the destination plus the onboarding-status
      // API agreeing the deed is actually signed server-side, not just
      // that the button stopped being disabled.
      await Promise.all([
        page.waitForURL("/", { timeout: 15_000 }),
        // exact: true — the wizard's own step sidebar also has a nav
        // item whose accessible name is "4 Sign deed", a substring
        // match on "Sign deed" alone catches both.
        page.getByRole("button", { name: "Sign deed", exact: true }).click(),
      ]);

      const statusRes = await context.request.get(`${BACKEND_URL}/founders/me/onboarding-status`);
      const status = await statusRes.json();
      expect(status.steps.deedSigned.complete).toBe(true);
      expect(status.onboardingComplete).toBe(true);
    } finally {
      await context.close();
    }
  });

  test.afterEach(async () => {
    // Deliberately NOT cleaned up beyond the notification: a signed
    // FoundationDeed is a real legal record, and `foundation_deeds` has
    // a DB trigger making it immutable — DELETE is rejected outright
    // (see the 20260827145212_add_foundation_deed migration), the same
    // "never hard-delete a governed record" posture CLAUDE.md's own
    // non-negotiables already apply to audit_logs. FoundationDeed also
    // FKs straight to the User and Founder who signed it, so neither of
    // those can be deleted either while it exists. This is correct,
    // not a leak: this test's fixture Foundation/Founder/User/Waqf stay
    // in the dev database permanently, exactly as a real signed deed's
    // own Foundation/Founder/signer would.
    await prisma.notification.deleteMany({ where: { recipientUser: { email: { startsWith: "e2e-founder-" } } } });
  });
});

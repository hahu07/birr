// Deliberately scoped as a frontend contract test, not a full-stack
// payment integration test — PaystackAdapter.createPayment() makes a
// real external call to Paystack with no test-mode credentials
// available in this environment, so a genuine end-to-end payment round
// trip isn't something this suite can drive. Backend contribution/
// compliance logic (identity thresholds, provider availability, etc.)
// already has 93+ Jest specs covering it. What Playwright uniquely adds
// here is real browser behavior: real navigation, real DOM rendering of
// the cause cards built this session, and — the concrete bug that
// motivated this suite's existence — the error-vs-empty-state
// distinction on the public vault pages (see commit 33b9e49), now
// provable against a real browser rendering a real (network-faked)
// failure, not just a vitest unit test.
import { test, expect } from "@playwright/test";
import { prisma } from "@birr/db";
import { seedStaffUser, seedOpenVault } from "./fixtures/seed";

// Tracks exactly what each test in this file creates, so afterEach
// cleans up precisely those rows — never a prefix-based bulk delete.
// seedStaffUser()'s fixture email prefix ("e2e-staff-") is shared with
// e2e/auth.setup.ts's own "setup" project, which runs in the same
// database just before this file's tests do and enrolls real MFA
// (creating MfaBackupCode rows) on its own "e2e-staff-*" user — a
// prefix-wide delete here would have torn down that still-in-use
// fixture (and hit its MfaBackupCode foreign key) along with this
// file's own rows. Tracking ids avoids both problems at once.
const createdStaffUserIds: string[] = [];
const createdVaultIds: string[] = [];

async function seedFixtureStaffUser() {
  const staff = await seedStaffUser();
  createdStaffUserIds.push(staff.userId);
  return staff;
}

async function seedFixtureOpenVault(actorUserId: string) {
  const vault = await seedOpenVault(actorUserId);
  createdVaultIds.push(vault.vaultId);
  return vault;
}

test.describe("public vault browsing", () => {
  test("open vaults list renders a real seeded vault with its cause", async ({ page }) => {
    const staff = await seedFixtureStaffUser();
    const { slug, causeName } = await seedFixtureOpenVault(staff.userId);

    await page.goto("/vaults");
    await expect(page.getByText(causeName).first()).toBeVisible();

    const vaultLink = page.locator(`a[href="/vaults/${slug}"]`);
    await expect(vaultLink).toBeVisible();
  });

  test("a failed open-vaults fetch shows the error state, not the empty state", async ({ page }) => {
    await page.route("**/vaults/open", (route) => route.fulfill({ status: 500, body: "boom" }));

    await page.goto("/vaults");

    await expect(page.getByText("Couldn't load open vaults")).toBeVisible();
    await expect(page.getByText("No vaults are open for giving right now")).not.toBeVisible();
  });

  test("vault detail page renders the cause card with its purpose and progress bar", async ({ page }) => {
    const staff = await seedFixtureStaffUser();
    const { slug, causeName } = await seedFixtureOpenVault(staff.userId);

    await page.goto(`/vaults/${slug}`);

    await expect(page.getByText(causeName).first()).toBeVisible();
    // CauseCard has no accessible progressbar role — it's a plain
    // width-styled div (see page.tsx's own CauseCard) — so the bar's
    // presence is verified through its "raised"/"goal" labels instead.
    await expect(page.getByText(/raised/).first()).toBeVisible();
    await expect(page.getByText(/goal/).first()).toBeVisible();
  });

  test("a genuine 404 (unpublished/unknown slug) shows the not-open state, not the network-error state", async ({ page }) => {
    // vaults/[slug]/page.tsx deliberately tells these two failures
    // apart (see its own loadError/vault===null comment, added this
    // session after a misconfigured NEXT_PUBLIC_BACKEND_URL produced a
    // 404-shaped response that got mislabeled as "vault closed") — a
    // real 404 from GET /vaults/by-slug/:slug sets vault to null
    // ("isn't open right now"), while any other failure sets loadError
    // ("couldn't load"). An unknown slug exercises the real 404 path.
    await page.goto("/vaults/this-slug-does-not-exist");
    await expect(page.getByText("This vault isn't open right now.")).toBeVisible();
    await expect(page.getByText("Couldn't load this vault.")).not.toBeVisible();
  });

  test("a non-404 failure loading a vault shows the network-error state, not the not-open state", async ({ page }) => {
    await page.route("**/vaults/by-slug/**", (route) => route.fulfill({ status: 500, body: "boom" }));
    await page.goto("/vaults/anything");
    await expect(page.getByText("Couldn't load this vault.")).toBeVisible();
    await expect(page.getByText("This vault isn't open right now.")).not.toBeVisible();
  });
});

test.describe("donation submission", () => {
  test("a successful contribution redirects to the returned checkout URL", async ({ page }) => {
    const staff = await seedFixtureStaffUser();
    const { slug, minimumAmount } = await seedFixtureOpenVault(staff.userId);
    // A relative, same-origin path — not a real external domain like
    // checkout.paystack.com. This suite's webServer is the only thing
    // guaranteed reachable from this sandbox; a live third-party domain
    // isn't (observed: an intermittent browser-level network error
    // instead of a real navigation, failing this assertion outright on
    // a network hiccup that has nothing to do with the app itself).
    // Next.js renders its own 404 here, which is still a real,
    // successful same-origin navigation — exactly what this test needs
    // to prove window.location.href actually fired with the backend's
    // returned checkoutUrl.
    const checkoutUrl = "/e2e-fixture-checkout";

    await page.route("**/vault-contributions", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ clientPayload: { checkoutUrl } }),
      }),
    );

    await page.goto(`/vaults/${slug}`);
    await page.getByLabel("Amount").fill(minimumAmount);
    await page.getByLabel("Email").fill("donor@e2e.birr.test");

    await Promise.all([
      page.waitForURL(checkoutUrl, { timeout: 10_000 }),
      page.getByRole("button", { name: "Continue to payment" }).click(),
    ]);

    await expect(page).toHaveURL(checkoutUrl);
  });

  test("a failed contribution shows the error alert and keeps the donor on the form", async ({ page }) => {
    const staff = await seedFixtureStaffUser();
    const { slug, minimumAmount } = await seedFixtureOpenVault(staff.userId);

    await page.route("**/vault-contributions", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "That payment method isn't available for this currency." }),
      }),
    );

    await page.goto(`/vaults/${slug}`);
    await page.getByLabel("Amount").fill(minimumAmount);
    await page.getByLabel("Email").fill("donor@e2e.birr.test");
    await page.getByRole("button", { name: "Continue to payment" }).click();

    await expect(page.getByText("Couldn't process your contribution")).toBeVisible();
    await expect(page.getByText("That payment method isn't available for this currency.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/vaults/${slug}$`));
  });

  test("an identity-required error reveals the ID fields instead of a generic failure", async ({ page }) => {
    const staff = await seedFixtureStaffUser();
    const { slug, minimumAmount } = await seedFixtureOpenVault(staff.userId);

    await page.route("**/vault-contributions", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Identity verification is required for this amount.", code: "IDENTITY_REQUIRED" }),
      }),
    );

    await page.goto(`/vaults/${slug}`);
    await page.getByLabel("Amount").fill(minimumAmount);
    await page.getByLabel("Email").fill("donor@e2e.birr.test");
    await page.getByRole("button", { name: "Continue to payment" }).click();

    await expect(page.getByText("Identity verification is required for this amount.")).toBeVisible();
    await expect(page.getByLabel("ID type")).toBeVisible();
    await expect(page.getByLabel("ID number")).toBeVisible();
  });
});

test.afterEach(async () => {
  while (createdVaultIds.length > 0) {
    const vaultId = createdVaultIds.pop()!;
    await prisma.vaultCause.deleteMany({ where: { vaultId } });
    await prisma.vault.delete({ where: { id: vaultId } }).catch(() => {});
  }
  while (createdStaffUserIds.length > 0) {
    const userId = createdStaffUserIds.pop()!;
    await prisma.mfaBackupCode.deleteMany({ where: { userId } });
    await prisma.birrStaff.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
});

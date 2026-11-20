// Kifayah's public journey (built as the need-based waqf's in NB4): from the
// list to its page, choosing its spending fund, to the hand-off to Paystack.
// Like donation-flow.spec.ts, a frontend contract test: the checkout call
// is faked at the network, since Paystack can't be reached from here; the
// gift logic itself is covered by the backend's Jest specs.
import { test, expect } from "@playwright/test";
import { seedKifayahWaqf, seedStaffUser } from "./fixtures/seed";

test.describe("Kifayah", () => {
  test("a giver finds Kifayah, reads that support hasn't started, and gives to its spending fund", async ({ page }) => {
    const maker = await seedStaffUser("mutawalli_officer");
    const checker = await seedStaffUser("board_of_trustees");
    const { slug, name } = await seedKifayahWaqf(maker.userId, checker.userId);

    await page.goto("/kifayah");
    await page.locator(`a[href="/kifayah/${slug}"]`).click();

    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Support hasn't started yet")).toBeVisible();
    await expect(page.getByText("The spending fund", { exact: true })).toBeVisible();

    let sent: Record<string, unknown> | null = null;
    await page.route("**/programme-gifts", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ gift: {}, clientPayload: { checkoutUrl: "/kifayah" } }) });
    });

    await page.getByText("Give to the spending fund").click();
    await page.getByLabel("Amount").fill("7500");
    await page.getByRole("button", { name: /^Give ₦7,500/ }).click();

    await expect.poll(() => sent).not.toBeNull();
    expect(sent).toMatchObject({ slug, pot: "running", amount: "7500" });
  });

  test("Kifayah isn't shown at a clinic address", async ({ page }) => {
    const maker = await seedStaffUser("mutawalli_officer");
    const checker = await seedStaffUser("board_of_trustees");
    const { slug } = await seedKifayahWaqf(maker.userId, checker.userId);

    await page.goto(`/clinics/${slug}`);
    await expect(page.getByText("We couldn't find this page.")).toBeVisible();
  });
});

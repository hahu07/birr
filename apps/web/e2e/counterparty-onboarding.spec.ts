// Counterparty onboarding — the second real maker-checker family in this
// app, and the only one with a THIRD gate ahead of the governed action
// itself: a Counterparty can't go `active` until (1) a shariah_board_member
// records their own sign-off directly on the detail page, AND (2) a
// counterparty.onboard governed action (investment_committee proposes,
// several roles including shariah_board_member can check) is approved —
// see counterparties/[id]/page.tsx's own header comment and
// CounterpartiesService.onboard()'s own defense-in-depth check that
// refuses the governed action if gate (1) never happened. Nothing else
// in this suite drives a two-gate flow like this through real UI.
//
// shariah_board_member does double duty here — records the sign-off,
// then later decides the governed action as its checker — which the
// DB's own checker-not-maker constraint allows (the maker is
// investment_committee, a different person), and keeps this spec to 2
// real staff identities instead of 3.
import { test, expect, type BrowserContext } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { prisma } from "@birr/db";
import { seedStaffUser } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

// Same standalone real-login-plus-MFA-enrollment helper as
// approval-queue.spec.ts/waqf-governance.spec.ts's own copies.
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

test.describe("Counterparty onboarding", () => {
  test("registration, Shariah sign-off, proposal, and approval all work through the real Ops Console", async ({
    browser,
  }) => {
    const icContext = await browser.newContext();
    const shariahContext = await browser.newContext();
    const counterpartyName = `E2E Counterparty ${Date.now()}`;

    try {
      const ic = await loginAndEnrollStaff(icContext, "investment_committee");
      const shariah = await loginAndEnrollStaff(shariahContext, "shariah_board_member");

      const icPage = await icContext.newPage();
      await icPage.goto("/ops/counterparties");
      await icPage.getByRole("button", { name: "Register counterparty" }).click();

      // Name has no <label htmlFor>/id pairing and no placeholder (see
      // CounterpartiesPage.tsx's own RegisterForm) — but it's a real
      // autoFocus input, same reasoning as ops-vault-curation.spec.ts's
      // own custom-cause Name field.
      await icPage.keyboard.type(counterpartyName);
      await icPage.getByPlaceholder("AE").fill("NG");
      await icPage
        .getByPlaceholder(/What this counterparty actually does/)
        .fill("Provides commercial banking and asset custody services; earns conventional interest on deposits.");
      await icPage.getByRole("button", { name: "Register", exact: true }).click();

      const counterpartyLink = icPage.getByRole("link", { name: counterpartyName });
      await expect(counterpartyLink).toBeVisible({ timeout: 10_000 });

      // /ops/counterparties/[id] is a dynamic route this run hasn't
      // visited yet — Turbopack compiles each route lazily on its first
      // hit (same class of delay ops-vault-curation.spec.ts's own
      // comment on this exact gap flags), so wait for the real
      // navigation first, generously.
      await Promise.all([
        icPage.waitForURL(/\/ops\/counterparties\/[^/]+$/, { timeout: 20_000 }),
        counterpartyLink.click(),
      ]);
      await expect(icPage.getByRole("heading", { name: counterpartyName })).toBeVisible({ timeout: 20_000 });
      const counterpartyId = new URL(icPage.url()).pathname.split("/").pop();

      // Neither gate has happened yet — investment_committee has
      // nothing to do here until Shariah signs off.
      await expect(icPage.getByText("Not yet recorded")).toBeVisible();
      await expect(icPage.getByRole("button", { name: "Record Shariah approval" })).toHaveCount(0);
      await expect(icPage.getByRole("button", { name: "Propose onboarding" })).toHaveCount(0);

      const shariahPage = await shariahContext.newPage();
      await shariahPage.goto(`/ops/counterparties/${counterpartyId}`);
      await expect(shariahPage.getByRole("heading", { name: counterpartyName })).toBeVisible({ timeout: 20_000 });
      await shariahPage.getByRole("button", { name: "Record Shariah approval" }).click();
      await expect(shariahPage.getByText("Signed off", { exact: false })).toBeVisible({ timeout: 10_000 });

      await icPage.reload();
      await expect(icPage.getByRole("heading", { name: counterpartyName })).toBeVisible({ timeout: 20_000 });
      await expect(icPage.getByText("Signed off", { exact: false })).toBeVisible();
      await icPage.getByRole("button", { name: "Propose onboarding" }).click();
      await expect(icPage.getByText("Onboarding already proposed", { exact: false })).toBeVisible({ timeout: 10_000 });

      const proposed = await prisma.governedAction.findFirstOrThrow({
        where: { permission: { key: "counterparty.onboard" }, payload: { path: ["counterpartyId"], equals: counterpartyId } },
      });
      expect(proposed.status).toBe("proposed");
      expect(proposed.makerUserId).toBe(ic.userId);

      // Same shariah_board_member identity, now acting as the checker —
      // allowed since the maker was investment_committee, a different
      // person (the DB's own checker-not-maker constraint is about the
      // individual, not the role).
      shariahPage.on("dialog", (dialog) => dialog.accept());
      await shariahPage.goto("/ops/governed-actions");
      const queueRow = shariahPage.locator("tr", { hasText: counterpartyName });
      // First visit to this route in this session, fetching a queue
      // that accumulates rows across every spec file in a full-suite
      // run — the same class of cold-load delay ops-vault-curation.spec.ts's
      // own comment on the dynamic-route case flags, here on first data
      // fetch rather than first compile.
      await expect(queueRow).toBeVisible({ timeout: 20_000 });
      await queueRow.getByRole("button", { name: /Onboard/ }).click();
      await queueRow.getByRole("button", { name: "Approve" }).click();
      await expect(queueRow.getByText("Approved")).toBeVisible({ timeout: 10_000 });

      const decided = await prisma.governedAction.findUniqueOrThrow({ where: { id: proposed.id } });
      expect(decided.status).toBe("approved");
      expect(decided.checkerUserId).toBe(shariah.userId);
      expect(decided.checkerUserId).not.toBe(decided.makerUserId);

      const onboarded = await prisma.counterparty.findUniqueOrThrow({ where: { id: counterpartyId } });
      expect(onboarded.status).toBe("active");

      await icPage.reload();
      await expect(icPage.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });
    } finally {
      const counterparty = await prisma.counterparty.findFirst({ where: { name: counterpartyName } });
      if (counterparty) {
        await prisma.governedAction.deleteMany({
          where: { permission: { key: "counterparty.onboard" }, payload: { path: ["counterpartyId"], equals: counterparty.id } },
        });
        await prisma.counterparty.deleteMany({ where: { id: counterparty.id } });
      }

      await icContext.close();
      await shariahContext.close();
    }
  });
});

test.afterEach(async () => {
  await prisma.notification.deleteMany({ where: { recipientUser: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.mfaBackupCode.deleteMany({ where: { user: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.birrStaff.deleteMany({ where: { user: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-staff-" } } });
});

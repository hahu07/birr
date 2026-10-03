// Playwright's "setup project" pattern (see playwright.config.ts's own
// projects array: "chromium" depends on "setup") — runs once, signs in
// both session types via real backend HTTP calls, and saves each
// resulting cookie jar to disk so every real test starts already
// authenticated instead of re-driving login on every spec.
//
// Deliberately real HTTP for every auth step (login, MFA enroll +
// confirm), not a synthesized session cookie — see
// e2e/fixtures/seed.ts's own comment on why: a storageState file this
// session.ts internals could silently drift from (if this suite built
// its own JWT instead of asking the backend to) would only prove this
// suite agrees with itself, not that real sign-in actually works. The
// one deliberate exception is WhatsApp verification (seedEstablishedFounder
// sets whatsappVerifiedAt directly) — there is no email-link-style
// callback to drive for an OTP a real phone would receive, so that one
// step is seeded, not re-driven; see founder-establishment.spec.ts for
// the one flow that instead drives real email verification through its
// own token, which this suite CAN do.
import { test as setup, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { seedStaffUser, seedEstablishedFounder } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

const STAFF_AUTH_FILE = "e2e/.auth/staff.json";
const FOUNDER_AUTH_FILE = "e2e/.auth/founder.json";

setup("authenticate as birr_staff", async ({ context }) => {
  const staff = await seedStaffUser("mutawalli_officer");
  const api = context.request;

  const loginRes = await api.post(`${BACKEND_URL}/birr-staff/login`, {
    data: { email: staff.email, password: staff.password },
  });
  expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
  const loginBody = await loginRes.json();
  expect(loginBody.mfaRequired).toBe(false); // not yet enrolled — see BirrStaffService.login's own comment

  const enrollRes = await api.post(`${BACKEND_URL}/birr-staff/me/mfa/enroll`);
  expect(enrollRes.ok(), await enrollRes.text()).toBeTruthy();
  const { secretForManualEntry } = await enrollRes.json();

  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: secretForManualEntry });
  const confirmRes = await api.post(`${BACKEND_URL}/birr-staff/me/mfa/enroll/confirm`, {
    data: { code: totp.generate() },
  });
  expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy();

  await context.storageState({ path: STAFF_AUTH_FILE });
});

setup("authenticate as founder_user", async ({ context }) => {
  const founder = await seedEstablishedFounder();
  const api = context.request;

  const loginRes = await api.post(`${BACKEND_URL}/founders/login`, {
    data: { username: founder.email, password: founder.password },
  });
  expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
  const loginBody = await loginRes.json();
  expect(loginBody.mfaRequired).toBe(false); // Founder MFA is opt-in — see FoundersService.login's own comment

  await context.storageState({ path: FOUNDER_AUTH_FILE });
});

// The dual-session cookie boundary: Founder (`birr_session`) and Birr
// staff (`birr_staff_session`) are deliberately separate cookies (see
// session.ts's own comment), specifically so a browser signed into both
// at once — a real scenario since the merge, e.g. a Birr staffer also
// testing their own Founder account — never leaks one portal's data
// into the other. CLAUDE.md's own "What's preserved despite the merge"
// note names the real historical bug this guards: a dual-purpose route
// (WaqfsController.list() and ~20 others) once inferred which audience
// a request was for from cookie presence alone, so a valid staff cookie
// made a Founder Portal page's own call resolve as a staff call and
// return the full unscoped list. The fix was x-birr-portal, sent by
// path (lib/api.ts's own currentPortal()) rather than inferred from
// cookies — this spec proves that holds with both sessions genuinely
// live in one browser at once, not two separate contexts that never
// actually have to disambiguate anything.
import { test, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { prisma } from "@birr/db";
import { seedStaffUser, seedEstablishedFounder } from "./fixtures/seed";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? `http://localhost:${process.env.E2E_BACKEND_PORT ?? "4150"}`;

test.describe("dual Founder/staff session boundary", () => {
  test("a browser holding both sessions still gets each portal's own scoped data, never the other's", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const api = context.request;

    try {
      const founder = await seedEstablishedFounder();
      // Our own waqf — what the founder-portal branch should return.
      const ownWaqf = await prisma.waqf.create({
        data: { foundationId: founder.foundationId, name: "E2E Boundary Own Waqf", type: "project", jurisdiction: "NG" },
      });
      // Unrelated noise: a second Foundation/Founder/Waqf this session
      // has no membership in — proves founder-scoping actually narrows,
      // rather than every waqf happening to pass through unfiltered.
      const otherFoundation = await prisma.foundation.create({ data: { name: "E2E Boundary Other Foundation" } });
      const otherFounder = await prisma.founder.create({ data: { name: "E2E Boundary Other Founder", kind: "institution" } });
      await prisma.foundationFounder.create({ data: { foundationId: otherFoundation.id, founderId: otherFounder.id } });
      const otherWaqf = await prisma.waqf.create({
        data: { foundationId: otherFoundation.id, name: "E2E Boundary Other Waqf", type: "project", jurisdiction: "NG" },
      });

      try {
        const founderLogin = await api.post(`${BACKEND_URL}/founders/login`, {
          data: { username: founder.email, password: founder.password },
        });
        expect(founderLogin.ok(), await founderLogin.text()).toBeTruthy();

        const staff = await seedStaffUser();
        const staffLogin = await api.post(`${BACKEND_URL}/birr-staff/login`, {
          data: { email: staff.email, password: staff.password },
        });
        expect(staffLogin.ok(), await staffLogin.text()).toBeTruthy();
        const enrollRes = await api.post(`${BACKEND_URL}/birr-staff/me/mfa/enroll`);
        const { secretForManualEntry } = await enrollRes.json();
        const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: secretForManualEntry });
        const confirmRes = await api.post(`${BACKEND_URL}/birr-staff/me/mfa/enroll/confirm`, {
          data: { code: totp.generate() },
        });
        expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy();

        // Both birr_session and birr_staff_session now sit in the same
        // cookie jar at once — exactly the "signed into both" scenario.
        const cookies = await context.cookies();
        expect(cookies.some((c) => c.name === "birr_session")).toBe(true);
        expect(cookies.some((c) => c.name === "birr_staff_session")).toBe(true);

        // A Founder Portal page's own call — x-birr-portal: founder,
        // exactly what currentPortal() sends for any non-/ops pathname —
        // must stay scoped to this founder's own waqf, regardless of the
        // valid staff cookie riding along in the same jar.
        const founderPortalCall = await api.get(`${BACKEND_URL}/waqfs`, { headers: { "x-birr-portal": "founder" } });
        expect(founderPortalCall.ok(), await founderPortalCall.text()).toBeTruthy();
        const founderPortalWaqfs = await founderPortalCall.json();
        const founderPortalIds = founderPortalWaqfs.map((w: { id: string }) => w.id);
        expect(founderPortalIds).toContain(ownWaqf.id);
        expect(founderPortalIds).not.toContain(otherWaqf.id);

        // The same browser's Ops Console call — x-birr-portal: ops,
        // what currentPortal() sends for any /ops pathname — still
        // correctly resolves as the staff session and sees the
        // unscoped list, so the fix didn't just make staff access stop
        // working from a dual-session browser.
        const opsPortalCall = await api.get(`${BACKEND_URL}/waqfs`, { headers: { "x-birr-portal": "ops" } });
        expect(opsPortalCall.ok(), await opsPortalCall.text()).toBeTruthy();
        const opsPortalWaqfs = await opsPortalCall.json();
        const opsPortalIds = opsPortalWaqfs.map((w: { id: string }) => w.id);
        expect(opsPortalIds).toContain(ownWaqf.id);
        expect(opsPortalIds).toContain(otherWaqf.id);

        // And the real pages agree: the Founder Portal's own app-shell
        // (app-shell.tsx) renders this founder's fullName, the Ops
        // Console's (ops/app-shell.tsx) renders the staff's — in the
        // SAME browser, one navigation apart, each from its own session
        // cookie, with neither route group bouncing to the other's
        // sign-in.
        const page = await context.newPage();
        await page.goto("/");
        await expect(page.getByText("E2E Fixture Founder")).toBeVisible({ timeout: 10_000 });

        await page.goto("/ops");
        await expect(page.getByText("E2E Fixture Staff")).toBeVisible({ timeout: 10_000 });
      } finally {
        await prisma.waqf.deleteMany({ where: { id: { in: [ownWaqf.id, otherWaqf.id] } } });
        await prisma.foundationFounder.deleteMany({ where: { foundationId: otherFoundation.id } });
        await prisma.foundation.delete({ where: { id: otherFoundation.id } }).catch(() => {});
        await prisma.founder.delete({ where: { id: otherFounder.id } }).catch(() => {});
      }
    } finally {
      await context.close();
    }
  });
});

test.afterEach(async () => {
  // NotificationsService fires a real notification row (governed_action
  // proposed/decided, etc.) off several of the real HTTP calls this spec
  // makes — its own recipientUserId FK blocks deleting the User beneath
  // it otherwise.
  await prisma.notification.deleteMany({
    where: { recipientUser: { email: { startsWith: "e2e-founder-" } } },
  });
  await prisma.notification.deleteMany({
    where: { recipientUser: { email: { startsWith: "e2e-staff-" } } },
  });
  await prisma.founderMembership.deleteMany({ where: { user: { email: { startsWith: "e2e-founder-" } } } });
  await prisma.foundationFounder.deleteMany({ where: { founder: { name: "E2E Fixture Founder Org" } } });
  await prisma.foundation.deleteMany({ where: { name: { startsWith: "E2E Fixture Foundation " } } });
  await prisma.founder.deleteMany({ where: { name: "E2E Fixture Founder Org" } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-founder-" } } });
  await prisma.mfaBackupCode.deleteMany({ where: { user: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.birrStaff.deleteMany({ where: { user: { email: { startsWith: "e2e-staff-" } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-staff-" } } });
});

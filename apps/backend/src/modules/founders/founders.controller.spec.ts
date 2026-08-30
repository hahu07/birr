import { UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { prisma } from "@birr/db";
import { FoundersController } from "./founders.controller";
import { signSessionToken, SESSION_COOKIE_NAME } from "../../common/auth/session";

function requestWithCookie(token: string): Request {
  return { cookies: { [SESSION_COOKIE_NAME]: token } } as unknown as Request;
}

// Regression coverage for the founder/staff cookie-ambiguity bug class
// (same shared birr_session cookie backs both identities — see
// current-birr-staff.ts's own comment). GET /founders/me previously had
// no isBirrStaffSession() check, unlike WaqfsController/
// FoundationsController which were already fixed for this — a Birr
// staff member browsing the merged app's founder route group would
// resolve here as "a real user, no founder yet," which the founder
// AppShell then renders as onboarding-step-1 UI instead of bouncing
// them to /sign-in.
describe("FoundersController — staff/founder session isolation", () => {
  let staffUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase.
    const staffUser = await prisma.user.create({
      data: { email: `founders-controller-staff-${Date.now()}@example.test`, fullName: "Staff, Not Founder" },
    });
    staffUserId = staffUser.id;
    await prisma.birrStaff.create({
      data: { userId: staffUser.id, staffRole: "compliance_officer" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Constructor deps are never reached — both methods reject before
  // touching `this.service`/`this.whatsAppVerification` for a staff
  // session, so real instances aren't needed here.
  const controller = new FoundersController(undefined as never, undefined as never);

  test("me() rejects a Birr staff session instead of treating it as a founder with no Foundation yet", async () => {
    const request = requestWithCookie(signSessionToken(staffUserId));
    await expect(controller.me(request)).rejects.toThrow(UnauthorizedException);
  });

  test("myOnboardingStatus() rejects a Birr staff session the same way", async () => {
    const request = requestWithCookie(signSessionToken(staffUserId));
    await expect(controller.myOnboardingStatus(request)).rejects.toThrow(UnauthorizedException);
  });
});

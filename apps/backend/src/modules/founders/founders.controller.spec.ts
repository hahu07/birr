import { UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { prisma } from "@birr/db";
import { FoundersController } from "./founders.controller";
import { FoundersService } from "./founders.service";
import { signSessionToken, SESSION_COOKIE_NAME, STAFF_SESSION_COOKIE_NAME } from "../../common/auth/session";

function requestWithFounderCookie(token: string): Request {
  return { cookies: { [SESSION_COOKIE_NAME]: token } } as unknown as Request;
}

function requestWithStaffCookie(token: string): Request {
  return { cookies: { [STAFF_SESSION_COOKIE_NAME]: token } } as unknown as Request;
}

function requestWithNoCookie(): Request {
  return { cookies: {} } as unknown as Request;
}

// Regression coverage for the founder/staff cookie-ambiguity bug class.
// GET /founders/me used to have no isBirrStaffSession() check, and
// Founder/staff sessions used to share one cookie — together, a Birr
// staff member browsing the merged app's founder route group could
// resolve here as "a real user, no founder yet," which the founder
// AppShell then renders as onboarding-step-1 UI instead of bouncing
// them to /sign-in. Fixed twice, structurally: first by adding an
// explicit isBirrStaffSession() guard, then superseded by giving
// Founder and staff sessions separate cookies (STAFF_SESSION_COOKIE_NAME
// vs SESSION_COOKIE_NAME) — resolveUserFromSession now has no staff-
// session input it COULD misresolve, so the explicit guard was removed
// as redundant (see founders.controller.ts's own comment). These tests
// now exercise a request that carries ONLY a staff cookie (no founder
// cookie at all) — the realistic shape of "a staff member's browser
// hits a founder-only route" — and confirm it's still cleanly rejected.
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
  // touching `this.service`/`this.whatsAppVerification` for a
  // staff-cookie-only request, so real instances aren't needed here.
  const controller = new FoundersController(undefined as never, undefined as never);

  test("me() rejects a request carrying only a staff session, no founder cookie", async () => {
    const request = requestWithStaffCookie(signSessionToken(staffUserId));
    await expect(controller.me(request)).rejects.toThrow(UnauthorizedException);
  });

  test("myOnboardingStatus() rejects a request carrying only a staff session, no founder cookie", async () => {
    const request = requestWithStaffCookie(signSessionToken(staffUserId));
    await expect(controller.myOnboardingStatus(request)).rejects.toThrow(UnauthorizedException);
  });
});

// Regression coverage for the unauthenticated founder-roster disclosure
// found in the 2026-08-31 codebase audit: list()/findById() had no
// session check at all on this @Public() controller — any anonymous
// caller could enumerate every Founder record, or fetch one by guessed
// id. Fixed to require a Birr-staff session, same remediation shape as
// the earlier FoundationsController/WaqfsController audit fixes.
describe("FoundersController — list()/findById() are Birr-staff only", () => {
  let staffUserId: string;
  let founderUserId: string;
  let founderId: string;

  beforeAll(async () => {
    const staffUser = await prisma.user.create({
      data: { email: `founders-roster-staff-${Date.now()}@example.test`, fullName: "Staff, Roster Test" },
    });
    staffUserId = staffUser.id;
    await prisma.birrStaff.create({
      data: { userId: staffUser.id, staffRole: "compliance_officer" },
    });

    const founderUser = await prisma.user.create({
      data: { email: `founders-roster-founder-${Date.now()}@example.test`, fullName: "Founder, Roster Test" },
    });
    founderUserId = founderUser.id;
    const founder = await prisma.founder.create({
      data: { name: "Roster Test Founder Org", kind: "institution" },
    });
    founderId = founder.id;
    await prisma.founderMembership.create({
      data: { userId: founderUser.id, founderId: founder.id, permissionLevel: "primary_contact" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // list()/findById() only ever call this.service — no other dependency
  // is touched, so a real FoundersService with unused constructor args is
  // fine here (its email/logo dependencies are never invoked by either
  // route).
  const controller = new FoundersController(new FoundersService(undefined as never, undefined as never), undefined as never);

  test("list() rejects a request with no session at all", async () => {
    await expect(controller.list(requestWithNoCookie())).rejects.toThrow(UnauthorizedException);
  });

  test("list() rejects a Founder session", async () => {
    const request = requestWithFounderCookie(signSessionToken(founderUserId));
    await expect(controller.list(request)).rejects.toThrow(UnauthorizedException);
  });

  test("list() succeeds for a Birr staff session", async () => {
    const request = requestWithStaffCookie(signSessionToken(staffUserId));
    const result = await controller.list(request);
    expect(Array.isArray(result)).toBe(true);
  });

  test("findById() rejects a request with no session at all", async () => {
    await expect(controller.findById(founderId, requestWithNoCookie())).rejects.toThrow(UnauthorizedException);
  });

  test("findById() rejects a Founder session, even for that founder's own id", async () => {
    const request = requestWithFounderCookie(signSessionToken(founderUserId));
    await expect(controller.findById(founderId, request)).rejects.toThrow(UnauthorizedException);
  });

  test("findById() succeeds for a Birr staff session", async () => {
    const request = requestWithStaffCookie(signSessionToken(staffUserId));
    const result = await controller.findById(founderId, request);
    expect(result.id).toBe(founderId);
  });
});

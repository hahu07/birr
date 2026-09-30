import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { prisma } from "@birr/db";
import { isBirrStaffSession, resolveBirrStaffFromSession, resolveCurrentBirrStaff } from "./current-birr-staff";
import { signSessionToken, STAFF_SESSION_COOKIE_NAME } from "./session";
import { MfaExempt } from "../guards/mfa-exempt.decorator";

function makeContext(request: Request, handler: () => void = () => {}, cls: new () => unknown = class {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function requestWithCookie(token?: string): Request {
  return { cookies: token ? { [STAFF_SESSION_COOKIE_NAME]: token } : {} } as unknown as Request;
}

describe("resolveBirrStaffFromSession", () => {
  let activeUserId: string;
  let inactiveUserId: string;
  let userWithNoStaffId: string;
  let unenrolledUserId: string;

  beforeAll(async () => {
    // Fixture Users/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase (audit_logs references, and
    // that table is insert-only at the DB role level).
    const activeUser = await prisma.user.create({
      // mfaEnabled: true — this fixture is the "fully set up" happy
      // path; the requireMfa-specific behavior below has its own
      // dedicated fixture/tests.
      data: { email: `current-birr-staff-active-${Date.now()}@example.test`, fullName: "Active Staff", mfaEnabled: true },
    });
    activeUserId = activeUser.id;
    await prisma.birrStaff.create({
      data: { userId: activeUser.id, staffRole: "compliance_officer", status: "active" },
    });

    const inactiveUser = await prisma.user.create({
      data: { email: `current-birr-staff-inactive-${Date.now()}@example.test`, fullName: "Inactive Staff", mfaEnabled: true },
    });
    inactiveUserId = inactiveUser.id;
    await prisma.birrStaff.create({
      data: { userId: inactiveUser.id, staffRole: "compliance_officer", status: "suspended" },
    });

    const plainUser = await prisma.user.create({
      data: { email: `current-birr-staff-no-staff-${Date.now()}@example.test`, fullName: "Founder, Not Staff" },
    });
    userWithNoStaffId = plainUser.id;

    // mfaEnabled defaults to false — a real session that hasn't
    // completed MFA enrollment yet.
    const unenrolledUser = await prisma.user.create({
      data: { email: `current-birr-staff-unenrolled-${Date.now()}@example.test`, fullName: "Unenrolled Staff" },
    });
    unenrolledUserId = unenrolledUser.id;
    await prisma.birrStaff.create({
      data: { userId: unenrolledUser.id, staffRole: "compliance_officer", status: "active" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("resolves the active BirrStaff for a valid session cookie", async () => {
    const request = requestWithCookie(signSessionToken(activeUserId));
    const staff = await resolveBirrStaffFromSession(request);
    expect(staff.userId).toBe(activeUserId);
    expect(staff.staffRole).toBe("compliance_officer");
  });

  test("rejects a missing session cookie", async () => {
    await expect(resolveBirrStaffFromSession(requestWithCookie(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  test("rejects a tampered/malformed session token", async () => {
    await expect(
      resolveBirrStaffFromSession(requestWithCookie("not-a-real-jwt")),
    ).rejects.toThrow(UnauthorizedException);
  });

  test("rejects a valid session for a User with no BirrStaff row", async () => {
    const request = requestWithCookie(signSessionToken(userWithNoStaffId));
    await expect(resolveBirrStaffFromSession(request)).rejects.toThrow(UnauthorizedException);
  });

  test("rejects a valid session for a suspended BirrStaff", async () => {
    const request = requestWithCookie(signSessionToken(inactiveUserId));
    await expect(resolveBirrStaffFromSession(request)).rejects.toThrow(UnauthorizedException);
  });

  // 2026-09-30 fix — see this function's own comment: a caller with no
  // options (the default) must fail closed for an unenrolled session,
  // since this is the one enforcement point for every direct
  // isBirrStaffSession()/resolveBirrStaffFromSession() call site that
  // isn't behind a guard that separately calls assertStaffMfa().
  describe("requireMfa", () => {
    test("rejects a session with mfaEnabled: false by default", async () => {
      const request = requestWithCookie(signSessionToken(unenrolledUserId));
      await expect(resolveBirrStaffFromSession(request)).rejects.toThrow(ForbiddenException);
      await expect(resolveBirrStaffFromSession(request)).rejects.toThrow(/Two-factor/);
    });

    test("resolves a session with mfaEnabled: false when requireMfa: false is passed", async () => {
      const request = requestWithCookie(signSessionToken(unenrolledUserId));
      const staff = await resolveBirrStaffFromSession(request, { requireMfa: false });
      expect(staff.userId).toBe(unenrolledUserId);
      expect(staff.mfaEnabled).toBe(false);
    });

    test("requireMfa: false doesn't relax the other checks (inactive staff still rejected)", async () => {
      const request = requestWithCookie(signSessionToken(inactiveUserId));
      await expect(resolveBirrStaffFromSession(request, { requireMfa: false })).rejects.toThrow(UnauthorizedException);
    });
  });

  // isBirrStaffSession() is the plain-boolean helper a large number of
  // handlers branch on directly (no guard involved) — see
  // resolveBirrStaffFromSession's own comment for the bypass this
  // section guards against regressing.
  describe("isBirrStaffSession()", () => {
    test("true for a fully-enrolled active staff session", async () => {
      const request = requestWithCookie(signSessionToken(activeUserId));
      await expect(isBirrStaffSession(request)).resolves.toBe(true);
    });

    test("false for a staff session that hasn't completed MFA — must not report as staff", async () => {
      const request = requestWithCookie(signSessionToken(unenrolledUserId));
      await expect(isBirrStaffSession(request)).resolves.toBe(false);
    });

    test("false for no session at all", async () => {
      await expect(isBirrStaffSession(requestWithCookie(undefined))).resolves.toBe(false);
    });
  });

  // resolveCurrentBirrStaff() is @CurrentBirrStaff()'s actual logic (see
  // that decorator's own comment) — same requireMfa: false +
  // assertStaffMfa two-step guards use, so @MfaExempt() routes using
  // @CurrentBirrStaff() (birr-staff.controller.ts's two enrollment
  // endpoints) stay reachable while every other route gets the real check.
  describe("resolveCurrentBirrStaff()", () => {
    class ExemptHandlerClass {
      @MfaExempt()
      exemptHandler() {}
      plainHandler() {}
    }
    const instance = new ExemptHandlerClass();

    test("resolves for a fully-enrolled session on a plain (non-exempt) route", async () => {
      const request = requestWithCookie(signSessionToken(activeUserId));
      const ctx = makeContext(request, instance.plainHandler, ExemptHandlerClass);
      const staff = await resolveCurrentBirrStaff(ctx);
      expect(staff.userId).toBe(activeUserId);
    });

    test("rejects an unenrolled session on a plain (non-exempt) route", async () => {
      const request = requestWithCookie(signSessionToken(unenrolledUserId));
      const ctx = makeContext(request, instance.plainHandler, ExemptHandlerClass);
      await expect(resolveCurrentBirrStaff(ctx)).rejects.toThrow(/Two-factor/);
    });

    test("allows an unenrolled session through on an @MfaExempt() route", async () => {
      const request = requestWithCookie(signSessionToken(unenrolledUserId));
      const ctx = makeContext(request, instance.exemptHandler, ExemptHandlerClass);
      const staff = await resolveCurrentBirrStaff(ctx);
      expect(staff.userId).toBe(unenrolledUserId);
    });
  });
});

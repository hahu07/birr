import { UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { prisma } from "@birr/db";
import { resolveBirrStaffFromSession } from "./current-birr-staff";
import { signSessionToken, SESSION_COOKIE_NAME } from "./session";

function requestWithCookie(token?: string): Request {
  return { cookies: token ? { [SESSION_COOKIE_NAME]: token } : {} } as unknown as Request;
}

describe("resolveBirrStaffFromSession", () => {
  let activeUserId: string;
  let inactiveUserId: string;
  let userWithNoStaffId: string;

  beforeAll(async () => {
    // Fixture Users/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase (audit_logs references, and
    // that table is insert-only at the DB role level).
    const activeUser = await prisma.user.create({
      data: { email: `current-birr-staff-active-${Date.now()}@example.test`, fullName: "Active Staff" },
    });
    activeUserId = activeUser.id;
    await prisma.birrStaff.create({
      data: { userId: activeUser.id, staffRole: "compliance_officer", status: "active" },
    });

    const inactiveUser = await prisma.user.create({
      data: { email: `current-birr-staff-inactive-${Date.now()}@example.test`, fullName: "Inactive Staff" },
    });
    inactiveUserId = inactiveUser.id;
    await prisma.birrStaff.create({
      data: { userId: inactiveUser.id, staffRole: "compliance_officer", status: "suspended" },
    });

    const plainUser = await prisma.user.create({
      data: { email: `current-birr-staff-no-staff-${Date.now()}@example.test`, fullName: "Founder, Not Staff" },
    });
    userWithNoStaffId = plainUser.id;
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
});

import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { prisma } from "@birr/db";
import { RequiresStaffRole, StaffRoleGuard } from "./staff-role.guard";
import { signSessionToken, STAFF_SESSION_COOKIE_NAME } from "../auth/session";

class TestController {
  @RequiresStaffRole("platform_admin")
  restricted() {}

  @RequiresStaffRole(["platform_admin", "mutawalli_officer"])
  restrictedToEitherOf() {}

  unrestricted() {}
}

function makeContext(handler: () => void, token?: string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({
      getRequest: () => ({ cookies: token ? { [STAFF_SESSION_COOKIE_NAME]: token } : {} }),
    }),
  } as unknown as ExecutionContext;
}

describe("StaffRoleGuard", () => {
  const guard = new StaffRoleGuard(new Reflector());
  const controller = new TestController();

  let adminUserId: string;
  let otherUserId: string;
  let mutawalliOfficerUserId: string;
  let noMfaAdminUserId: string;

  beforeAll(async () => {
    // Fixture Users/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase (audit_logs references, and
    // that table is insert-only at the DB role level).
    const adminUser = await prisma.user.create({
      data: { email: `staff-role-guard-admin-${Date.now()}@example.test`, fullName: "Guard Spec Admin", mfaEnabled: true },
    });
    await prisma.birrStaff.create({
      data: { userId: adminUser.id, staffRole: "platform_admin" },
    });
    adminUserId = adminUser.id;

    const otherUser = await prisma.user.create({
      data: { email: `staff-role-guard-other-${Date.now()}@example.test`, fullName: "Guard Spec Other", mfaEnabled: true },
    });
    await prisma.birrStaff.create({
      data: { userId: otherUser.id, staffRole: "compliance_officer" },
    });
    otherUserId = otherUser.id;

    const mutawalliOfficerUser = await prisma.user.create({
      data: { email: `staff-role-guard-mutawalli-${Date.now()}@example.test`, fullName: "Guard Spec Mutawalli Officer", mfaEnabled: true },
    });
    await prisma.birrStaff.create({
      data: { userId: mutawalliOfficerUser.id, staffRole: "mutawalli_officer" },
    });
    mutawalliOfficerUserId = mutawalliOfficerUser.id;

    const noMfaAdminUser = await prisma.user.create({
      data: { email: `staff-role-guard-no-mfa-${Date.now()}@example.test`, fullName: "Guard Spec Admin Without MFA" },
    });
    await prisma.birrStaff.create({ data: { userId: noMfaAdminUser.id, staffRole: "platform_admin" } });
    noMfaAdminUserId = noMfaAdminUser.id;
  });

  // SessionAuthGuard returns early on a @Public() controller, so this guard
  // must enforce mandatory MFA itself — otherwise a password-only session
  // reached platform_admin writes on e.g. cause-categories/waqf-funding.
  test("rejects the right role when that staff member hasn't completed MFA", async () => {
    const ctx = makeContext(controller.restricted, signSessionToken(noMfaAdminUserId));
    await expect(guard.canActivate(ctx)).rejects.toThrow(/Two-factor/);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("allows a matching role through", async () => {
    const ctx = makeContext(controller.restricted, signSessionToken(adminUserId));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  test("rejects a non-matching role with ForbiddenException", async () => {
    const ctx = makeContext(controller.restricted, signSessionToken(otherUserId));
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  test("rejects a missing session with UnauthorizedException", async () => {
    const ctx = makeContext(controller.restricted, undefined);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  test("is a no-op (returns true) for a route with no @RequiresStaffRole metadata", async () => {
    const ctx = makeContext(controller.unrestricted, undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  test("@RequiresStaffRole([...]) allows any one of several roles through", async () => {
    const asAdmin = makeContext(controller.restrictedToEitherOf, signSessionToken(adminUserId));
    await expect(guard.canActivate(asAdmin)).resolves.toBe(true);

    const asMutawalliOfficer = makeContext(controller.restrictedToEitherOf, signSessionToken(mutawalliOfficerUserId));
    await expect(guard.canActivate(asMutawalliOfficer)).resolves.toBe(true);
  });

  test("@RequiresStaffRole([...]) rejects a role outside the allowed list", async () => {
    const ctx = makeContext(controller.restrictedToEitherOf, signSessionToken(otherUserId));
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});

import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { prisma } from "@birr/db";
import { RequiresStaffRole, StaffRoleGuard } from "./staff-role.guard";
import { signSessionToken, SESSION_COOKIE_NAME } from "../auth/session";

class TestController {
  @RequiresStaffRole("platform_admin")
  restricted() {}

  unrestricted() {}
}

function makeContext(handler: () => void, token?: string): ExecutionContext {
  return {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ cookies: token ? { [SESSION_COOKIE_NAME]: token } : {} }),
    }),
  } as unknown as ExecutionContext;
}

describe("StaffRoleGuard", () => {
  const guard = new StaffRoleGuard(new Reflector());
  const controller = new TestController();

  let adminUserId: string;
  let otherUserId: string;

  beforeAll(async () => {
    // Fixture Users/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase (audit_logs references, and
    // that table is insert-only at the DB role level).
    const adminUser = await prisma.user.create({
      data: { email: `staff-role-guard-admin-${Date.now()}@example.test`, fullName: "Guard Spec Admin" },
    });
    await prisma.birrStaff.create({
      data: { userId: adminUser.id, staffRole: "platform_admin" },
    });
    adminUserId = adminUser.id;

    const otherUser = await prisma.user.create({
      data: { email: `staff-role-guard-other-${Date.now()}@example.test`, fullName: "Guard Spec Other" },
    });
    await prisma.birrStaff.create({
      data: { userId: otherUser.id, staffRole: "compliance_officer" },
    });
    otherUserId = otherUser.id;
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
});

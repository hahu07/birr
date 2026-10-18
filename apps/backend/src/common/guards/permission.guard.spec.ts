import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { prisma, BirrStaffRole } from "@birr/db";
import { PermissionGuard, RequiresAccess } from "./permission.guard";
import { signSessionToken, STAFF_SESSION_COOKIE_NAME } from "../auth/session";

// Uses the seeded grants (CI runs `prisma db seed` before tests):
// platform_settings.manage is platform_admin only; vault.status_change is
// mutawalli_officer or compliance_officer.
class TestController {
  @RequiresAccess("platform_settings.manage")
  adminOnly() {}

  @RequiresAccess("vault.status_change")
  eitherOfTwoRoles() {}

  @RequiresAccess("no_such.permission")
  unknownPermission() {}

  unrestricted() {}
}

function makeContext(handler: () => void, token?: string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({
      getRequest: () => ({ cookies: token ? { [STAFF_SESSION_COOKIE_NAME]: token } : {}, params: {}, body: {} }),
    }),
  } as unknown as ExecutionContext;
}

describe("PermissionGuard — @RequiresAccess", () => {
  const guard = new PermissionGuard(new Reflector());
  const controller = new TestController();
  const userIds: Partial<Record<BirrStaffRole | "noMfaAdmin", string>> = {};

  beforeAll(async () => {
    // Fixture Users/BirrStaff not cleaned up — audit_logs references, and
    // that table is insert-only at the DB role level.
    const make = async (key: BirrStaffRole | "noMfaAdmin", staffRole: BirrStaffRole, mfaEnabled = true) => {
      const user = await prisma.user.create({
        data: { email: `permission-guard-${key}-${Date.now()}@example.test`, fullName: `Guard Spec ${key}`, mfaEnabled },
      });
      await prisma.birrStaff.create({ data: { userId: user.id, staffRole } });
      userIds[key] = user.id;
    };
    await make("platform_admin", "platform_admin");
    await make("compliance_officer", "compliance_officer");
    await make("mutawalli_officer", "mutawalli_officer");
    await make("external_auditor", "external_auditor");
    await make("noMfaAdmin", "platform_admin", false);
  });

  afterAll(() => prisma.$disconnect());

  const as = (key: keyof typeof userIds) => signSessionToken(userIds[key]!);

  test("allows a role that holds the permission", async () => {
    await expect(guard.canActivate(makeContext(controller.adminOnly, as("platform_admin")))).resolves.toBe(true);
  });

  test("rejects a role that doesn't hold it", async () => {
    await expect(guard.canActivate(makeContext(controller.adminOnly, as("compliance_officer")))).rejects.toThrow(ForbiddenException);
  });

  test("a permission granted to several roles lets each of them through, and nobody else", async () => {
    await expect(guard.canActivate(makeContext(controller.eitherOfTwoRoles, as("mutawalli_officer")))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext(controller.eitherOfTwoRoles, as("compliance_officer")))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext(controller.eitherOfTwoRoles, as("external_auditor")))).rejects.toThrow(ForbiddenException);
  });

  // SessionAuthGuard returns early on a @Public() controller, so this guard
  // must enforce mandatory MFA itself.
  test("rejects the right role when that staff member hasn't completed MFA", async () => {
    await expect(guard.canActivate(makeContext(controller.adminOnly, as("noMfaAdmin")))).rejects.toThrow(/Two-factor/);
  });

  test("rejects a missing session", async () => {
    await expect(guard.canActivate(makeContext(controller.adminOnly))).rejects.toThrow(UnauthorizedException);
  });

  test("rejects an unknown permission key rather than letting it through", async () => {
    await expect(guard.canActivate(makeContext(controller.unknownPermission, as("platform_admin")))).rejects.toThrow(ForbiddenException);
  });

  test("is a no-op for a route with no permission metadata", async () => {
    await expect(guard.canActivate(makeContext(controller.unrestricted))).resolves.toBe(true);
  });
});

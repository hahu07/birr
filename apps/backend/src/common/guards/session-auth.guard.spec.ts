import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { prisma } from "@birr/db";
import { SessionAuthGuard } from "./session-auth.guard";
import { Public } from "./public.decorator";
import { signSessionToken, STAFF_SESSION_COOKIE_NAME } from "../auth/session";

class TestController {
  noMetadata() {}

  @Public()
  publicRoute() {}
}

@Public()
class PublicTestController {
  anyRoute() {}
}

function makeContext(handler: () => void, cls: Function, token?: string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ cookies: token ? { [STAFF_SESSION_COOKIE_NAME]: token } : {} }),
    }),
  } as unknown as ExecutionContext;
}

describe("SessionAuthGuard", () => {
  const guard = new SessionAuthGuard(new Reflector());
  const controller = new TestController();
  const publicController = new PublicTestController();

  let staffUserId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `session-auth-guard-${Date.now()}@example.test`, fullName: "Guard Spec Staff" },
    });
    staffUserId = user.id;
    await prisma.birrStaff.create({
      data: { userId: user.id, staffRole: "compliance_officer" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("rejects a route with no metadata and no session — the default-deny floor", async () => {
    const ctx = makeContext(controller.noMetadata, TestController, undefined);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  test("passes a route with no metadata through once a valid session is present", async () => {
    const ctx = makeContext(controller.noMetadata, TestController, signSessionToken(staffUserId));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  test("allows a @Public() route through with no session", async () => {
    const ctx = makeContext(controller.publicRoute, TestController, undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  test("allows any route on a @Public() controller through with no session", async () => {
    const ctx = makeContext(publicController.anyRoute, PublicTestController, undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

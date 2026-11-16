import "reflect-metadata";
import { BirrStaffController } from "./birr-staff.controller";

// The unilateral one-person MFA reset was removed on purpose — resetting
// a staff member's MFA is now the governed `staff.mfa_reset` action (a
// second person approves). This fails loudly if someone re-adds a direct
// route, which would silently undo that.
describe("BirrStaffController", () => {
  it("exposes no direct MFA-reset route (it must go through governed_actions)", () => {
    const proto = BirrStaffController.prototype as unknown as Record<string, unknown>;
    expect(proto.resetMfa).toBeUndefined();
    const paths = Object.getOwnPropertyNames(proto)
      .map((name) => proto[name])
      .filter((fn): fn is (...args: unknown[]) => unknown => typeof fn === "function")
      .map((fn) => String(Reflect.getMetadata("path", fn) ?? ""));
    expect(paths.some((p) => /mfa\/reset/.test(p))).toBe(false);
  });
});

// Last sign-in (2026-11-16): recorded when a staff session is actually
// issued — never on the password step alone when a code is still due.
describe("BirrStaffController sign-in recording", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { signMfaPendingToken, MFA_PENDING_COOKIE_NAME } = require("../../common/auth/session");
  const res = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });
  const make = (mfaEnabled: boolean) => {
    const service = {
      login: jest.fn().mockResolvedValue({ userId: "user-1", mfaEnabled }),
      verifyLoginMfaCode: jest.fn().mockResolvedValue(undefined),
      recordSignIn: jest.fn().mockResolvedValue(undefined),
    };
    return { service, controller: new BirrStaffController(service as never, {} as never) };
  };

  beforeAll(() => {
    process.env.JWT_SECRET ??= "test-secret-for-sign-in-recording-0123456789";
  });

  it("records it when the password alone completes sign-in (no two-factor yet)", async () => {
    const { service, controller } = make(false);
    await controller.login({ email: "a@example.com", password: "x" } as never, res() as never);
    expect(service.recordSignIn).toHaveBeenCalledWith("user-1");
  });

  it("doesn't record it at the password step when a code is still due, only once the code is accepted", async () => {
    const { service, controller } = make(true);
    await controller.login({ email: "a@example.com", password: "x" } as never, res() as never);
    expect(service.recordSignIn).not.toHaveBeenCalled();
    const req = { cookies: { [MFA_PENDING_COOKIE_NAME]: signMfaPendingToken("user-1") } };
    await controller.verifyLoginMfa({ code: "123456" } as never, req as never, res() as never);
    expect(service.recordSignIn).toHaveBeenCalledWith("user-1");
  });
});

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

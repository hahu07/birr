import jwt from "jsonwebtoken";
import type { Request } from "express";
import { signMfaPendingToken, signSessionToken, verifyMfaPendingToken, verifySessionToken, STAFF_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "./session";
import { resolveBirrStaffFromSession } from "./current-birr-staff";
import { resolveUserFromSession } from "./current-founder";

// Security review, 2026-11-17: the "password correct, now enter your code"
// token was accepted as a full session, so a password alone got past
// two-factor, for staff and founders alike.
describe("session tokens", () => {
  const userId = "00000000-0000-4000-8000-000000000001";

  test("a full session token is a session", () => {
    expect(verifySessionToken(signSessionToken(userId))).toEqual({ userId });
  });

  test("the token waiting for a two-factor code is never a session", () => {
    const pending = signMfaPendingToken(userId);
    expect(verifySessionToken(pending)).toBeNull();
    expect(verifyMfaPendingToken(pending)).toEqual({ userId });
  });

  test("a session can't stand in for the two-factor step either", () => {
    expect(verifyMfaPendingToken(signSessionToken(userId))).toBeNull();
  });

  test("a token signed with the right secret but no session mark is refused", () => {
    const unmarked = jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: "7d" });
    expect(verifySessionToken(unmarked)).toBeNull();
  });

  test("both portals refuse the waiting token as their session cookie, before looking anyone up", async () => {
    const pending = signMfaPendingToken(userId);
    const staff = { cookies: { [STAFF_SESSION_COOKIE_NAME]: pending }, headers: {} } as unknown as Request;
    await expect(resolveBirrStaffFromSession(staff)).rejects.toThrow(/Session expired or invalid/);
    const founder = { cookies: { [SESSION_COOKIE_NAME]: pending }, headers: {} } as unknown as Request;
    await expect(resolveUserFromSession(founder)).rejects.toThrow();
  });
});

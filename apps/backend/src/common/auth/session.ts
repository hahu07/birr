import jwt from "jsonwebtoken";
import type { Request, Response } from "express";

export const SESSION_COOKIE_NAME = "birr_session";
// Distinct name (and cookie) from SESSION_COOKIE_NAME so a Founder and a
// Birr-staff member can hold sessions in the same browser at once —
// before this, both sides shared one cookie name/path, so signing into
// one silently invalidated the other's session (2026-09-02 codebase
// audit finding — not an authorization bypass on its own, since the
// backend always disambiguated correctly by resolving the user and
// checking for a BirrStaff row, but it defeated the "no shared session
// state between the two surfaces" goal at the cookie-jar level).
export const STAFF_SESSION_COOKIE_NAME = "birr_staff_session";
const SESSION_VALIDITY = "7d";

interface SessionTokenPayload {
  userId: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }
  return secret;
}

export function signSessionToken(userId: string): string {
  return jwt.sign({ userId } satisfies SessionTokenPayload, getSecret(), { expiresIn: SESSION_VALIDITY });
}

/** Returns null on any verification failure (expired, tampered, malformed) rather than throwing — callers treat this identically to "no session." */
export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret());
    if (typeof decoded === "string" || typeof decoded.userId !== "string") return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

/**
 * httpOnly so client-side JS can never read the token (XSS mitigation);
 * sameSite "lax" is sufficient without needing "none"/HTTPS in local dev
 * — the SameSite attribute treats localhost:3000 and localhost:4001 as
 * same-site (it ignores port), even though they're different origins
 * for CORS purposes. secure is only forced once we're actually served
 * over HTTPS in production.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

// Staff-side counterparts — see STAFF_SESSION_COOKIE_NAME's own comment.
export function setStaffSessionCookie(res: Response, token: string): void {
  res.cookie(STAFF_SESSION_COOKIE_NAME, token, cookieOptions());
}

export function clearStaffSessionCookie(res: Response): void {
  res.clearCookie(STAFF_SESSION_COOKIE_NAME, { path: "/" });
}

/**
 * "Is *some* session present, Founder or Birr-staff" — the generic gate
 * every dual-purpose controller checks before calling isBirrStaffSession
 * to disambiguate which one. Needs both cookie names now that they're
 * separate (see STAFF_SESSION_COOKIE_NAME's own comment) — before the
 * split, checking SESSION_COOKIE_NAME alone was sufficient since both
 * sides shared it.
 */
export function hasAnySessionCookie(request: Pick<Request, "cookies">): boolean {
  return Boolean(request.cookies?.[SESSION_COOKIE_NAME] || request.cookies?.[STAFF_SESSION_COOKIE_NAME]);
}

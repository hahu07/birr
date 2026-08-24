import jwt from "jsonwebtoken";
import type { Response } from "express";

export const SESSION_COOKIE_NAME = "birr_session";
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
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

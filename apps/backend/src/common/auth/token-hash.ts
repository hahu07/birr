import { createHash } from "crypto";

/**
 * Password-reset and email-verification tokens are stored as this hash,
 * never as emailed (security review, 2026-11-17): someone who can read
 * the database or a backup can't use what they see to reset an account.
 * The tokens are 32 random bytes, so a plain SHA-256 is enough (no salt
 * or slow hash needed, unlike a password).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

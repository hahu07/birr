import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { hash, compare } from "bcryptjs";
import * as OTPAuth from "otpauth";
import * as QRCode from "qrcode";

// Matches password-auth.ts's own BCRYPT_ROUNDS — not imported from
// there since that constant isn't exported, but the same value for the
// same reason (backup codes are a credential, same posture as a
// password).
const BCRYPT_ROUNDS = 10;
const ISSUER = "Birr Ops Console";
const BACKUP_CODE_COUNT = 10;

export interface GeneratedTotpSecret {
  secretBase32: string;
  otpauthUri: string;
}

/**
 * TOTP (RFC 6238) + backup codes for birr_staff MFA — see
 * BirrStaffService's own comment on why this is mandatory, not opt-in.
 * Pure/stateless: no Prisma access here, callers own persistence
 * (encrypting/storing the secret, hashing/storing backup codes) so this
 * stays unit-testable with no DB.
 */
@Injectable()
export class MfaService {
  generateSecret(email: string): GeneratedTotpSecret {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });
    return { secretBase32: secret.base32, otpauthUri: totp.toString() };
  }

  qrCodeDataUrl(otpauthUri: string): Promise<string> {
    return QRCode.toDataURL(otpauthUri);
  }

  /**
   * window: 1 tolerates the previous/next 30s step for ordinary clock
   * drift between the server and the staff member's device — otauth's
   * validate() returns the matched step's delta (0 for an exact match,
   * not truthy-checkable) or null on no match, so this must check
   * `!== null`, not truthiness.
   */
  verifyCode(secretBase32: string, code: string): boolean {
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    return totp.validate({ token: code, window: 1 }) !== null;
  }

  /** Plaintext — caller shows these to the staff member exactly once and hashes them for storage via hashBackupCodes(). */
  generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
    return Array.from({ length: count }, () => randomBytes(5).toString("hex"));
  }

  hashBackupCodes(codes: string[]): Promise<string[]> {
    return Promise.all(codes.map((code) => hash(code, BCRYPT_ROUNDS)));
  }

  compareBackupCode(code: string, codeHash: string): Promise<boolean> {
    return compare(code, codeHash);
  }
}

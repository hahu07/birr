import * as OTPAuth from "otpauth";
import type { Request } from "express";
import { prisma } from "@birr/db";
import { MfaService } from "./mfa.service";
import { claimSignInCode } from "./mfa-claims";
import { signSessionToken, sessionStillValid, SESSION_COOKIE_NAME } from "./session";
import { resolveUserFromSession } from "./current-founder";

// Security review, 2026-11-17: a two-factor code could be used twice in its
// window, a backup code could be claimed by two requests at once, and a
// password or two-factor reset left existing sessions signed in.
describe("sign-in codes and sessions", () => {
  const mfa = new MfaService();
  const run = Date.now();
  let userId: string;
  let secret: string;

  beforeAll(async () => {
    secret = mfa.generateSecret(`claims-${run}@example.test`).secretBase32;
    const user = await prisma.user.create({
      data: { email: `claims-${run}@example.test`, fullName: "Claims Test", status: "active", mfaEnabled: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.mfaBackupCode.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  });

  const currentCode = () =>
    new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate();

  test("an authenticator code signs in once, never twice", async () => {
    const code = currentCode();
    await expect(claimSignInCode(mfa, userId, secret, code)).resolves.toBeUndefined();
    await expect(claimSignInCode(mfa, userId, secret, code)).rejects.toThrow(/already been used/);
    await expect(claimSignInCode(mfa, userId, secret, "000000" === code ? "111111" : "000000")).rejects.toThrow(/Incorrect code/);
  });

  test("a backup code is claimed once, even by two requests at the same moment", async () => {
    const [code] = mfa.generateBackupCodes(1);
    const [codeHash] = await mfa.hashBackupCodes([code!]);
    await prisma.mfaBackupCode.create({ data: { userId, codeHash: codeHash! } });
    const results = await Promise.allSettled([claimSignInCode(mfa, userId, secret, code!), claimSignInCode(mfa, userId, secret, code!)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  test("a reset ends every session issued before it", async () => {
    const issuedBefore = Math.floor(Date.now() / 1000) - 60;
    expect(sessionStillValid(issuedBefore, null)).toBe(true);
    expect(sessionStillValid(issuedBefore, new Date())).toBe(false);
    expect(sessionStillValid(Math.floor(Date.now() / 1000), new Date())).toBe(true);

    const session = signSessionToken(userId);
    const request = { cookies: { [SESSION_COOKIE_NAME]: session }, headers: {} } as unknown as Request;
    await expect(resolveUserFromSession(request)).resolves.toMatchObject({ id: userId });
    await prisma.user.update({ where: { id: userId }, data: { sessionsValidFrom: new Date(Date.now() + 1000) } });
    await expect(resolveUserFromSession(request)).rejects.toThrow(/sign in again/);
  });
});

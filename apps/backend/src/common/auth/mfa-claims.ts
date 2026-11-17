import { UnauthorizedException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { MfaService } from "./mfa.service";

/**
 * Sign-in's second step, for staff and founders alike (security review,
 * 2026-11-17). A code from the authenticator app is accepted once: its
 * 30-second step is recorded, and a code from that step or an earlier one
 * is refused, so someone who sees a code typed can't use it again. A
 * backup code is claimed in one write, so two requests can't both use it.
 */
export async function claimSignInCode(mfa: MfaService, userId: string, secretBase32: string, code: string): Promise<void> {
  const step = mfa.matchedStep(secretBase32, code);
  if (step !== null) {
    const claimed = await prisma.user.updateMany({
      where: { id: userId, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
      data: { mfaLastUsedStep: step },
    });
    if (claimed.count === 1) return;
    throw new UnauthorizedException("That code has already been used. Wait for the next one in your app.");
  }

  const unusedCodes = await prisma.mfaBackupCode.findMany({ where: { userId, usedAt: null } });
  for (const candidate of unusedCodes) {
    if (await mfa.compareBackupCode(code, candidate.codeHash)) {
      const claimed = await prisma.mfaBackupCode.updateMany({ where: { id: candidate.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count === 1) return;
      break;
    }
  }
  throw new UnauthorizedException("Incorrect code.");
}

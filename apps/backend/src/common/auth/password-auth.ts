import { UnauthorizedException } from "@nestjs/common";
import { hash, compare } from "bcryptjs";
import { prisma, User } from "@birr/db";

const BCRYPT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_ROUNDS);
}

/**
 * Shared by FoundersService.login and BirrStaffService.login — both
 * authenticate the same underlying User table, just resolve a different
 * downstream record (FounderMembership vs BirrStaff) afterward. Throws
 * rather than returning null so both call sites get the same generic
 * "incorrect email or password" behavior without duplicating the check.
 */
export async function verifyUserPassword(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    throw new UnauthorizedException("Incorrect email or password.");
  }
  const matches = await compare(password, user.passwordHash);
  if (!matches) {
    throw new UnauthorizedException("Incorrect email or password.");
  }
  if (user.status === "suspended") {
    throw new UnauthorizedException("This account has been suspended.");
  }
  return user;
}

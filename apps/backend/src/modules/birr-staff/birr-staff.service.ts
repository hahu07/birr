import { Injectable, NotFoundException } from "@nestjs/common";
import { IsEmail, IsEnum, IsString } from "class-validator";
import { prisma, BirrStaffRole } from "@birr/db";
import { verifyUserPassword } from "../../common/auth/password-auth";

export class CreateBirrStaffInput {
  @IsEmail()
  email!: string;

  @IsString()
  fullName!: string;

  @IsEnum(BirrStaffRole)
  staffRole!: BirrStaffRole;
}

export class BirrStaffLoginInput {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

// Never select passwordHash (or the email-verification token) onto a
// response body — findById/list/getSessionSummary all nest the User
// record for display purposes only, not to hand the client someone's
// credential material back. Same principle as
// FoundersService.getSessionSummary's explicit field pick.
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  mfaEnabled: true,
} as const;

@Injectable()
export class BirrStaffService {
  // Gated to platform_admin at the controller (@RequiresStaffRole) —
  // real staff onboarding goes through InvitationsService.accept(),
  // which sets a password and logs the invitee straight in. This method
  // stays for admin/scripted bootstrap use (e.g. minting the very first
  // platform_admin), so it deliberately doesn't set a password; a staff
  // record created this way can't log in via /birr-staff/login until an
  // Invitation-based flow or a future "set password" route covers it.
  //
  // No standalone Users module exists yet (CLAUDE.md lists `users` as
  // entity #1, but nothing in apps/backend owns it directly) — creating a
  // BirrStaff member inherently provisions the underlying User account in
  // the same transaction, since BirrStaff.userId is a required unique FK.
  async create(input: CreateBirrStaffInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, fullName: input.fullName },
      });
      const staff = await tx.birrStaff.create({
        data: { userId: user.id, staffRole: input.staffRole },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "birr_staff.created",
          entityType: "BirrStaff",
          entityId: staff.id,
          after: staff as any,
        },
      });
      return staff;
    });
  }

  findById(id: string) {
    return prisma.birrStaff.findUnique({ where: { id }, include: { user: { select: SAFE_USER_SELECT } } });
  }

  list() {
    return prisma.birrStaff.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: SAFE_USER_SELECT } },
    });
  }

  async login(input: BirrStaffLoginInput) {
    const user = await verifyUserPassword(input.email, input.password);
    const staff = await prisma.birrStaff.findUnique({ where: { userId: user.id } });
    if (!staff || staff.status !== "active") {
      throw new NotFoundException("No active Birr staff account for this user.");
    }
    return { userId: user.id };
  }

  /** GET /birr-staff/me — session bootstrap for the Ops Console. */
  async getSessionSummary(userId: string) {
    const staff = await prisma.birrStaff.findUniqueOrThrow({
      where: { userId },
      include: { user: { select: SAFE_USER_SELECT } },
    });
    return staff;
  }
}

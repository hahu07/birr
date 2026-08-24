import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { IsString, MinLength } from "class-validator";
import { prisma, InviteeKind, BirrStaffRole, FounderPermissionLevel } from "@birr/db";
import { hashPassword } from "../../common/auth/password-auth";

const INVITATION_VALIDITY_DAYS = 7;
const MIN_PASSWORD_LENGTH = 8;

export interface InviteInput {
  inviteeKind: InviteeKind;
  email: string;
  founderId?: string;
  roleKey: string;
  invitedByUserId: string;
}

export class AcceptInput {
  @IsString()
  token!: string;

  @IsString()
  fullName!: string;

  @MinLength(MIN_PASSWORD_LENGTH)
  password!: string;
}

@Injectable()
export class InvitationsService {
  async invite(input: InviteInput) {
    if (input.inviteeKind === "founder_user") {
      if (!input.founderId) {
        throw new BadRequestException("founderId is required for a founder_user invitation.");
      }
      const founder = await prisma.founder.findUnique({ where: { id: input.founderId } });
      if (!founder) {
        throw new NotFoundException(`Founder "${input.founderId}" not found.`);
      }
      if (!Object.values(FounderPermissionLevel).includes(input.roleKey as any)) {
        throw new BadRequestException(`"${input.roleKey}" is not a valid FounderPermissionLevel.`);
      }
    } else {
      if (input.founderId) {
        throw new BadRequestException("founderId must not be set for a birr_staff invitation.");
      }
      if (!Object.values(BirrStaffRole).includes(input.roleKey as any)) {
        throw new BadRequestException(`"${input.roleKey}" is not a valid BirrStaffRole.`);
      }
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

    return prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.create({
        data: {
          inviteeKind: input.inviteeKind,
          email: input.email,
          founderId: input.founderId,
          roleKey: input.roleKey,
          invitedBy: input.invitedByUserId,
          token,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId: input.invitedByUserId,
          action: "invitation.sent",
          entityType: "Invitation",
          entityId: invitation.id,
          after: invitation as any,
        },
      });

      return invitation;
    });
  }

  /**
   * Deliberately no auth check here — the token itself is the
   * credential. The whole point is onboarding someone who has no account
   * yet, so there's nothing to authenticate them against beforehand.
   */
  async accept(input: AcceptInput) {
    const invitation = await prisma.invitation.findUnique({
      where: { token: input.token },
    });
    if (!invitation) {
      throw new NotFoundException("Invitation not found.");
    }
    if (invitation.status !== "pending") {
      throw new BadRequestException(
        `Invitation has already been ${invitation.status}.`,
      );
    }
    if (invitation.expiresAt < new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "expired" },
      });
      throw new BadRequestException("Invitation has expired.");
    }
    // Also enforced by AcceptInput's own @MinLength decorator
    // (class-validator, global ValidationPipe) for any real HTTP
    // request — repeated here as defense-in-depth for direct callers,
    // same reasoning as FoundersService.signUp's identical check.
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const passwordHash = await hashPassword(input.password);

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: invitation.email, fullName: input.fullName, passwordHash, status: "active" },
      });

      const membershipOrStaff =
        invitation.inviteeKind === "founder_user"
          ? await tx.founderMembership.create({
              data: {
                founderId: invitation.founderId!,
                userId: user.id,
                permissionLevel: invitation.roleKey as FounderPermissionLevel,
                invitedBy: invitation.invitedBy,
              },
            })
          : await tx.birrStaff.create({
              data: {
                userId: user.id,
                staffRole: invitation.roleKey as BirrStaffRole,
              },
            });

      const accepted = await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "accepted" },
      });

      await tx.auditLog.create({
        data: {
          actorType: invitation.inviteeKind,
          actorUserId: user.id,
          action: "invitation.accepted",
          entityType: "Invitation",
          entityId: invitation.id,
          after: accepted as any,
        },
      });

      // Strip passwordHash before it ever reaches a response body — same
      // principle as BirrStaffService's SAFE_USER_SELECT.
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return { user: safeUser, membershipOrStaff, invitation: accepted };
    });
  }

  async revoke(id: string, revokedByUserId: string) {
    const invitation = await prisma.invitation.findUnique({ where: { id } });
    if (!invitation) throw new NotFoundException(`Invitation "${id}" not found.`);
    if (invitation.status !== "pending") {
      throw new BadRequestException(
        `Invitation "${id}" is already ${invitation.status}.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const revoked = await tx.invitation.update({
        where: { id },
        data: { status: "revoked" },
      });

      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId: revokedByUserId,
          action: "invitation.revoked",
          entityType: "Invitation",
          entityId: id,
          before: invitation as any,
          after: revoked as any,
        },
      });

      return revoked;
    });
  }

  findById(id: string) {
    return prisma.invitation.findUnique({ where: { id } });
  }

  list() {
    return prisma.invitation.findMany({ orderBy: { createdAt: "desc" } });
  }
}

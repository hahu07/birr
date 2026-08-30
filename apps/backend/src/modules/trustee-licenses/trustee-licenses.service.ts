import { Injectable, NotFoundException } from "@nestjs/common";
import { IsDateString, IsEnum, IsOptional, IsString } from "class-validator";
import { prisma, TrusteeLicenseStatus } from "@birr/db";
import { NotificationsService } from "../notifications/notifications.service";

export class CreateTrusteeLicenseInput {
  @IsString()
  jurisdiction!: string;

  @IsEnum(TrusteeLicenseStatus)
  status!: TrusteeLicenseStatus;

  @IsString()
  licensingAuthority!: string;

  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateTrusteeLicenseInput {
  @IsEnum(TrusteeLicenseStatus)
  status!: TrusteeLicenseStatus;

  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Injectable()
export class TrusteeLicensesService {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Represents Birr's actual regulatory standing to act as Mutawalli in a
  // jurisdiction (see CLAUDE.md's "Regulatory & assurance posture"
  // section) — a silent, unaudited change here is a real compliance
  // risk, same reasoning as SettingsService.set()/clear() for provider
  // credentials. Transaction keeps the write and its audit row atomic.
  create(input: CreateTrusteeLicenseInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const license = await tx.trusteeLicense.create({
        data: {
          jurisdiction: input.jurisdiction,
          status: input.status,
          licensingAuthority: input.licensingAuthority,
          licenseNumber: input.licenseNumber,
          issuedAt: input.issuedAt ? new Date(input.issuedAt) : undefined,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          notes: input.notes,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "trustee_license.created",
          entityType: "TrusteeLicense",
          entityId: license.id,
          after: license as any,
        },
      });
      return license;
    });
  }

  async update(id: string, input: UpdateTrusteeLicenseInput, actorUserId: string) {
    const { existing, updated } = await prisma.$transaction(async (tx) => {
      const existing = await tx.trusteeLicense.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Trustee license "${id}" not found.`);
      const updated = await tx.trusteeLicense.update({
        where: { id },
        data: {
          status: input.status,
          licenseNumber: input.licenseNumber,
          issuedAt: input.issuedAt ? new Date(input.issuedAt) : undefined,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          notes: input.notes,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "trustee_license.updated",
          entityType: "TrusteeLicense",
          entityId: updated.id,
          before: existing as any,
          after: updated as any,
        },
      });
      return { existing, updated };
    });

    // Only when the status itself actually changed — not every edit to
    // licenseNumber/notes/etc. Deliberately not awaited, same
    // fire-and-forget posture as every other post-transaction notify()
    // call this session.
    if (existing.status !== updated.status) {
      this.notifyAffectedFounders(updated.jurisdiction, updated.status).catch((err) => {
        console.error(`Failed to notify founders of trustee license status change "${updated.id}":`, err);
      });
    }

    return updated;
  }

  private async notifyAffectedFounders(jurisdiction: string, status: TrusteeLicenseStatus): Promise<void> {
    const affectedWaqfs = await prisma.waqf.findMany({
      where: { jurisdiction, deletedAt: null },
      select: {
        id: true,
        name: true,
        foundation: {
          select: {
            foundationFounders: {
              select: {
                founder: {
                  select: { memberships: { where: { status: "active" }, select: { userId: true } } },
                },
              },
            },
          },
        },
      },
    });

    await Promise.all(
      affectedWaqfs.map(async (waqf) => {
        const recipientUserIds = new Set<string>();
        for (const foundationFounder of waqf.foundation.foundationFounders) {
          for (const membership of foundationFounder.founder.memberships) {
            recipientUserIds.add(membership.userId);
          }
        }
        await Promise.all(
          [...recipientUserIds].map((userId) =>
            this.notificationsService.notify({
              recipientType: "founder_user",
              recipientUserId: userId,
              type: "trustee_license.status_changed",
              title: `Trustee license update — ${jurisdiction}`,
              body: `Birr's trustee license status in ${jurisdiction} changed to "${status}", affecting ${waqf.name}.`,
              linkUrl: `/portfolio/${waqf.id}`,
              relatedEntityType: "Waqf",
              relatedEntityId: waqf.id,
            }),
          ),
        );
      }),
    );
  }

  findById(id: string) {
    return prisma.trusteeLicense.findUnique({ where: { id } });
  }

  list() {
    return prisma.trusteeLicense.findMany({ orderBy: { jurisdiction: "asc" } });
  }

  /**
   * Used by WaqfsService to surface a flag, never to block — see this
   * model's own schema comment for why establishment isn't gated on it.
   * "unlicensed" (not just an empty array) is the meaningful signal a
   * caller acts on: no active, non-expired license row exists for this
   * jurisdiction at all.
   */
  async statusForJurisdiction(jurisdiction: string): Promise<TrusteeLicenseStatus | "unlicensed"> {
    const license = await prisma.trusteeLicense.findFirst({
      where: { jurisdiction, status: "active" },
      orderBy: { updatedAt: "desc" },
    });
    if (!license) return "unlicensed";
    if (license.expiresAt && license.expiresAt < new Date()) return "expired";
    return license.status;
  }
}

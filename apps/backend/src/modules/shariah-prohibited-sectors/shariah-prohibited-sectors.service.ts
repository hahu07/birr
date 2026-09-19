import { Injectable, NotFoundException } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { prisma } from "@birr/db";

export class UpsertShariahProhibitedSectorInput {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

// Staff-curated catalog a shariah_board_member references when deciding
// a ShariahScreening/VaultShariahScreening (see those models' own
// schema comment) — shared between Waqf and Vault investments, same
// posture as CauseCategory. Referenced by id from flaggedSectorIds
// (a plain string array, not a relation) — deleting a sector in active
// use leaves that id dangling on any screening that already flagged it,
// an accepted trade-off for not building a join table for a small,
// rarely-multi-valued set (same shape as Vault.additionalCurrencies).
@Injectable()
export class ShariahProhibitedSectorsService {
  create(input: UpsertShariahProhibitedSectorInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const sector = await tx.shariahProhibitedSector.create({ data: input });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "shariah_prohibited_sector.created",
          entityType: "ShariahProhibitedSector",
          entityId: sector.id,
          after: sector as any,
        },
      });
      return sector;
    });
  }

  update(id: string, input: UpsertShariahProhibitedSectorInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.shariahProhibitedSector.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Shariah prohibited sector "${id}" not found.`);
      const sector = await tx.shariahProhibitedSector.update({ where: { id }, data: input });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "shariah_prohibited_sector.updated",
          entityType: "ShariahProhibitedSector",
          entityId: sector.id,
          before: existing as any,
          after: sector as any,
        },
      });
      return sector;
    });
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.shariahProhibitedSector.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Shariah prohibited sector "${id}" not found.`);
      await tx.shariahProhibitedSector.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "shariah_prohibited_sector.deleted",
          entityType: "ShariahProhibitedSector",
          entityId: existing.id,
          before: existing as any,
        },
      });
    });
  }

  list() {
    return prisma.shariahProhibitedSector.findMany({ orderBy: { name: "asc" } });
  }
}

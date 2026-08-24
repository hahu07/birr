import { Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString, IsString } from "class-validator";
import { prisma, Prisma, AssetCategory } from "@birr/db";

export class CreateAssetInput {
  @IsString()
  waqfId!: string;

  @IsString()
  name!: string;

  @IsEnum(AssetCategory)
  category!: AssetCategory;

  // A Prisma.Decimal instance can't cross an HTTP boundary; every real
  // caller (the Ops Console form included) sends this as a numeric
  // string, which @IsNumberString validates.
  @IsNumberString()
  estimatedValue!: Prisma.Decimal | number | string;
}

export type CreateAssetActor =
  | { actorType: "birr_staff"; actorUserId: string }
  | { actorType: "system" };

@Injectable()
export class AssetsService {
  // Asset *registration* isn't in CLAUDE.md's governed-action list (only
  // disposal is) — plain CRUD, gated by SessionAuthGuard's default
  // "any authenticated staff" floor (see common/guards/session-auth.guard.ts),
  // same as every other route with no @RequiresPermission/@RequiresStaffRole.
  // That's a separate concern from CLAUDE.md's immutable-audit-trail
  // non-negotiable though — "not maker-checker gated" doesn't mean "not
  // audited"; every create on a governed entity still needs its own
  // audit_logs row, which this write's own transaction guarantees.
  //
  // Optional tx client — ContributionsService.handleWebhook() creates an
  // Asset inside its own transaction (Asset + Contribution + Waqf status
  // + audit log must all commit or all roll back together), so this
  // can't unconditionally open its own. Opens one when no caller-supplied
  // tx is given (the direct POST /assets path), so the create + audit
  // write are still atomic even standalone.
  create(input: CreateAssetInput, actor: CreateAssetActor, tx?: Prisma.TransactionClient) {
    const run = async (client: Prisma.TransactionClient | typeof prisma) => {
      const asset = await client.asset.create({ data: input });
      await client.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: actor.actorType,
          actorUserId: actor.actorType === "birr_staff" ? actor.actorUserId : undefined,
          action: "asset.created",
          entityType: "Asset",
          entityId: asset.id,
          after: asset as any,
        },
      });
      return asset;
    };
    return tx ? run(tx) : prisma.$transaction(run);
  }

  /**
   * Internal only — never expose this behind a public controller route.
   * asset.dispose is a governed action (see schema.prisma's comment on
   * Asset); the only caller is GovernedActionsService's handler map, on
   * approval, inside its own transaction.
   */
  async dispose(id: string, tx: Prisma.TransactionClient) {
    const asset = await tx.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException(`Asset "${id}" not found.`);
    return tx.asset.update({
      where: { id },
      data: { status: "disposed", disposedAt: new Date() },
    });
  }

  findById(id: string) {
    return prisma.asset.findUnique({ where: { id } });
  }

  list(waqfId?: string) {
    return prisma.asset.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }
}

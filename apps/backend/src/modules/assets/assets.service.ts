import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString, IsString } from "class-validator";
import { prisma, Prisma, AssetCategory } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";

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
      // currency is always derived here, never client-supplied — see
      // Asset.currency's own schema comment. This lookup also closes a
      // real pre-existing gap: nothing before this validated waqfId
      // actually referenced a real waqf at all.
      const waqf = await client.waqf.findUnique({ where: { id: input.waqfId } });
      if (!waqf) throw new NotFoundException(`Waqf "${input.waqfId}" not found.`);
      if (!waqf.corpusCurrency) {
        throw new BadRequestException(
          `Waqf "${waqf.name}" has no declared corpus currency yet — set one before registering assets against it.`,
        );
      }
      const asset = await client.asset.create({ data: { ...input, currency: waqf.corpusCurrency } });
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

  // Founder-Portal read-only visibility into their own waqf's registered
  // assets — no PII concern here (an asset isn't a person), unlike
  // Beneficiary. Returns null (not an empty array) when the waqf isn't
  // found or isn't theirs, matching WaqfCausesService.listForFounder's
  // convention — the controller turns that into a 404.
  async listForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) return null;
      return tx.asset.findMany({ where: { waqfId, deletedAt: null }, orderBy: { createdAt: "desc" } });
    });
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString, IsString } from "class-validator";
import { prisma, Prisma, AssetCategory } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";

// 2026-09-26 audit fix, same problem class as
// BeneficiariesService.MAX_UNSCOPED_LIST_ROWS (see that constant's own
// comment): list() below returns every Asset platform-wide in one
// unbounded response when waqfId is omitted. No caller in this codebase
// today omits it, so this cap has no effect on any known usage — it
// bounds the blast radius of that "see everything" path as the table
// grows.
export const MAX_UNSCOPED_LIST_ROWS = 200;

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
  /**
   * Atomic claim, not a plain update — checkDuplicate on asset.dispose's
   * governed-actions handler only blocks a second *pending* proposal
   * against the same asset; once one is approved and this runs, nothing
   * stops a later, separate proposal from being approved against the
   * same now-already-disposed asset (checkDuplicate's own
   * status: "proposed" filter finds nothing, since the first one is now
   * "approved"). Confirmed real, not theoretical. Same
   * updateMany-then-count pattern this codebase already uses for this
   * exact class of race elsewhere.
   */
  async dispose(id: string, tx: Prisma.TransactionClient) {
    const asset = await tx.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException(`Asset "${id}" not found.`);

    const { count } = await tx.asset.updateMany({
      where: { id, status: { not: "disposed" } },
      data: { status: "disposed", disposedAt: new Date() },
    });
    if (count !== 1) {
      throw new ConflictException("This asset has already been disposed.");
    }
    return tx.asset.findUniqueOrThrow({ where: { id } });
  }

  findById(id: string) {
    return prisma.asset.findUnique({ where: { id } });
  }

  // deletedAt: null on both branches — nothing currently soft-deletes an
  // Asset (status flips to "disposed" instead; see dispose() above), so
  // this is a no-op today, but listForFounder() below already filters it
  // and this method shouldn't silently resurrect retired rows the
  // moment something does start setting it (found during a
  // comprehensive codebase audit, 2026-10-03 — the exact same gap
  // existed in BeneficiariesService.list() and InvestmentsService
  // .list(), fixed alongside this one).
  list(waqfId?: string) {
    if (waqfId) {
      return prisma.asset.findMany({ where: { waqfId, deletedAt: null }, orderBy: { createdAt: "desc" } });
    }
    return prisma.asset.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: MAX_UNSCOPED_LIST_ROWS });
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

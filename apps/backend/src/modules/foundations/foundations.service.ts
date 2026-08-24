import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsArray, IsOptional, IsString } from "class-validator";
import { prisma } from "@birr/db";
import { assertFounderVerified } from "../../common/auth/current-founder";
import { withFounderScope } from "../../common/db/founder-scope";

export class CreateFoundationInput {
  @IsString()
  name!: string;

  // Required, not optional — "Foundation establishment should be
  // standard," per the stakeholder: a Foundation with no recorded
  // purpose is an incomplete dedication, not a valid one.
  @IsString()
  purpose!: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  // Not @ArrayNotEmpty() — the Founder Portal's self-service create()
  // call always sends [] here, since FoundationsController.create()
  // ignores this field entirely and forces [the caller's own founderId]
  // whenever a Founder session is present. Only the "system"/direct-API
  // path (no session) actually uses whatever list is sent.
  @IsArray()
  @IsString({ each: true })
  founderIds!: string[];
}

/**
 * Who's actually creating this Foundation — used only to attribute the
 * audit log entry correctly. "founder" is the normal self-service path
 * (a donor creating their own Foundation via the Founder Portal);
 * "system" covers internal/API callers (e.g. a direct script) where
 * there's no founder session to attribute it to.
 */
export type CreationActor = { type: "founder"; founderId: string } | { type: "system" };

@Injectable()
export class FoundationsService {
  /**
   * Plain CRUD, not a governed_actions action — a Foundation is a
   * lightweight organizational container ("a house for the portfolio of
   * waqf funds"), not itself a fiduciary/legal endowment, so it carries
   * none of the maker-checker weight that Waqf creation does. Still
   * audited, mirroring FoundersService.create()'s existing precedent for
   * non-governed org-hierarchy CRUD.
   */
  async create(input: CreateFoundationInput, actor: CreationActor = { type: "system" }) {
    if (!input.purpose?.trim()) {
      throw new BadRequestException("purpose is required.");
    }
    return prisma.$transaction(async (tx) => {
      if (actor.type === "founder") {
        await assertFounderVerified(tx, actor.founderId);
      }

      const founders = await tx.founder.findMany({
        where: { id: { in: input.founderIds } },
      });
      if (founders.length !== input.founderIds.length) {
        const found = new Set(founders.map((f) => f.id));
        const missing = input.founderIds.filter((id) => !found.has(id));
        throw new NotFoundException(`Unknown founder id(s): ${missing.join(", ")}`);
      }

      const foundation = await tx.foundation.create({
        data: {
          name: input.name,
          purpose: input.purpose,
          jurisdiction: input.jurisdiction,
        },
      });

      await tx.foundationFounder.createMany({
        data: input.founderIds.map((founderId) => ({ foundationId: foundation.id, founderId })),
      });

      await tx.auditLog.create({
        data: {
          actorType: actor.type === "founder" ? "founder_user" : "system",
          actorFounderId: actor.type === "founder" ? actor.founderId : undefined,
          action: "foundation.created",
          entityType: "Foundation",
          entityId: foundation.id,
          after: foundation as any,
        },
      });

      return foundation;
    });
  }

  findById(id: string) {
    return prisma.foundation.findUnique({ where: { id }, include: FOUNDATION_INCLUDE });
  }

  /**
   * Founder-session-scoped counterpart to findById() — used by
   * FoundationsController.findById() when a Founder Portal session is
   * present, so a signed-in Founder can't read another Founder's
   * foundation by id. Same withFounderScope pattern as list(). Returns
   * null (not throw) on no match — the controller turns that into a
   * 404, deliberately indistinguishable from "id doesn't exist at all."
   */
  findByIdForFounder(id: string, founderId: string) {
    return withFounderScope(founderId, (tx) =>
      tx.foundation.findFirst({
        where: { id, foundationFounders: { some: { founderId } } },
        include: FOUNDATION_INCLUDE,
      }),
    );
  }

  /**
   * Same set_config-then-filter pattern as WaqfsService.list() — the
   * founder_isolation RLS policy on "foundations"
   * (packages/db/prisma/migrations/20260802211506_drop_waqf_founders_and_rewrite_founder_isolation)
   * reads the same app.current_founder_id session variable.
   */
  list(founderId?: string) {
    if (!founderId) {
      return prisma.foundation.findMany({ include: FOUNDATION_INCLUDE, orderBy: { createdAt: "desc" } });
    }
    return withFounderScope(founderId, (tx) =>
      tx.foundation.findMany({
        where: { foundationFounders: { some: { founderId } } },
        include: FOUNDATION_INCLUDE,
        orderBy: { createdAt: "desc" },
      }),
    );
  }
}

// Ops Console's Foundations list page needs to show which Founder(s)
// own each Foundation and how many Waqf Funds it has, without a second
// round-trip per row — Founder Portal never calls list()/findById()
// today (it derives Foundation info from the nested waqf.foundation on
// GET /waqfs instead), so enriching this response is additive only.
const FOUNDATION_INCLUDE = {
  foundationFounders: { include: { founder: { select: { id: true, name: true } } } },
  _count: { select: { waqfs: true } },
} as const;

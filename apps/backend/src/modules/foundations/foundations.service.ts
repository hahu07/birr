import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { IsArray, IsOptional, IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";
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
  // whenever a Founder session is present. Only a genuinely trusted
  // (Birr-staff-authenticated) caller reaches the branch that uses
  // whatever list is sent — see that controller method's own
  // 2026-08-30 fix comment for why "no session" no longer counts as
  // trusted here.
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

    const run = async (tx: Prisma.TransactionClient) => {
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

      // Plain INSERT with no RETURNING — not tx.foundation.create(), which
      // always compiles to INSERT ... RETURNING. Postgres re-checks a
      // RETURNING row against the table's SELECT-relevant RLS policy (see
      // founder_isolation's own comment on this table), and a brand-new
      // Foundation can never pass that check yet: its only ownership link
      // (foundation_founders) doesn't exist until the very next statement
      // below. The policy's WITH CHECK(true) already lets a plain INSERT
      // through regardless — it's specifically RETURNING's implicit
      // visibility recheck a plain INSERT avoids. Found empirically
      // (2026-08-31) the first time RLS was actually enforced by a
      // non-superuser connection — see
      // 20260831183000_fix_foundations_self_service_insert_rls's own
      // comment.
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "foundations" ("id", "name", "purpose", "jurisdiction", "status", "createdAt", "updatedAt")
        VALUES (${id}, ${input.name}, ${input.purpose}, ${input.jurisdiction ?? null}, 'active', now(), now())
      `;

      await tx.foundationFounder.createMany({
        data: input.founderIds.map((founderId) => ({ foundationId: id, founderId })),
      });

      // Now that the ownership link exists, a plain read legitimately
      // passes founder_isolation's USING clause.
      const foundation = await tx.foundation.findUniqueOrThrow({ where: { id } });

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
    };

    // Routed through withFounderScope for the self-service founder path
    // (2026-08-31 codebase audit finding) — the ownership enforcement
    // above (founderIds is forced to just [actor.founderId] by the
    // controller) was already correct, but without the RLS session var
    // set, founder_isolation was a silent no-op on this write. Only
    // meaningful for a real founder actor — the "system"/trusted-caller
    // path can name multiple arbitrary founderIds (a joint Foundation),
    // so there's no single founder to scope RLS to there, and that path
    // was never founder-session-reachable to begin with.
    if (actor.type === "founder") {
      return withFounderScope(actor.founderId, run);
    }
    return prisma.$transaction(run);
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
      // A Foundation whose FoundationDeed pins it against hard-delete
      // (see purge-fixture-data.ts's own comment) can still end up with
      // zero linked Founders — normal DB rows, not a real operating
      // Foundation. Excluded here so the Ops Console list/Overview never
      // counts a deed-locked husk as one Birr actually manages.
      return prisma.foundation.findMany({
        where: { foundationFounders: { some: {} } },
        include: FOUNDATION_INCLUDE,
        orderBy: { createdAt: "desc" },
      });
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
// round-trip per row. The Founder Portal's own Foundation-detail page
// and onboarding step 4 also rely on this same shape now (co-founders,
// and whether the Foundation-level deed has been signed).
const FOUNDATION_INCLUDE = {
  foundationFounders: { include: { founder: { select: { id: true, name: true } } } },
  foundationDeed: true,
  _count: { select: { waqfs: true } },
} as const;

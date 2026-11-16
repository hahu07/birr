import { BadRequestException, ConflictException, ForbiddenException, forwardRef, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { IsNumberString, IsOptional, IsString, MaxLength } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { assertFounderVerified } from "../../common/auth/current-founder";
import { WaqfProceedsService } from "../waqf-proceeds/waqf-proceeds.service";
import { splitProRata } from "../../common/money/pro-rata";
import { moneyText } from "../../common/giving/giver-contact";
import { NotificationsService } from "../notifications/notifications.service";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const REASON_MIN = 5;
const REASON_MAX = 500;

/**
 * The founder's written reason for lowering, moving or removing an
 * allocation (owner's decision, 2026-11-16). Kept in the audit row and
 * shown to the fund's Mutawalli Officer.
 */
function requireReason(reason: string | undefined, doing: string): string {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < REASON_MIN) {
    throw new BadRequestException(`Please say why you're ${doing}. A few words is enough.`);
  }
  if (trimmed.length > REASON_MAX) {
    throw new BadRequestException(`Please keep the reason under ${REASON_MAX} characters.`);
  }
  return trimmed;
}

const ZERO = new Prisma.Decimal(0);
const maxOf = (a: Prisma.Decimal, b: Prisma.Decimal) => (a.gt(b) ? a : b);

export class CreateWaqfCauseInput {
  @IsString()
  waqfId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  // See WaqfCause.projectPlan's own schema comment — Birr-staff path
  // only (this DTO backs the custom-cause registration route, never a
  // Founder-facing one).
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  projectPlan?: string;
}

export class SelectCauseCategoryInput {
  @IsString()
  waqfId!: string;

  @IsString()
  causeCategoryId!: string;
}

export class AllocateCauseInput {
  @IsNumberString()
  amount!: Prisma.Decimal | number | string;

  /** Required when lowering an allocation above zero (2026-11-16). */
  @IsOptional()
  @IsString()
  @MaxLength(REASON_MAX)
  reason?: string;
}

/** Moving part of one cause's allocation to another cause of the same fund. */
export class MoveAllocationInput {
  @IsString()
  toCauseId!: string;

  @IsNumberString()
  amount!: string;

  @IsString()
  @MaxLength(REASON_MAX)
  reason!: string;
}

export class UnselectCauseInput {
  /** Required when the cause has an allocation (2026-11-16). */
  @IsOptional()
  @IsString()
  @MaxLength(REASON_MAX)
  reason?: string;
}

/**
 * Distribution statuses that hold a claim on a cause's allocation: the
 * same set DistributionsService.assertWithinAllocation counts.
 */
const COMMITTED_DISTRIBUTION_STATUSES = ["pending", "approved", "disbursing", "paid"] as const;

/**
 * Where a Waqf Fund's corpus allocation stands, in its pool currency.
 * Only Asset and Project funds spend corpus (an Investment fund's corpus
 * allocation is a preservation target; its distributions draw on
 * proceeds, CLAUDE.md 2026-09-04), so only they have committed money to
 * protect: appliesFloor is false for Investment, and committed figures
 * are then empty.
 */
export interface AllocationPosition {
  currency: string | null;
  /** True when no corpus currency is declared and contributions came in more than one. */
  ambiguousCurrency: boolean;
  raised: Prisma.Decimal;
  /** Σ over active causes of max(allocation, committed). */
  allocatedToActive: Prisma.Decimal;
  /** Committed money on causes the founder has removed: never free to allocate again. */
  heldByRemovedCauses: Prisma.Decimal;
  available: Prisma.Decimal;
  appliesFloor: boolean;
  committedByCause: Map<string, Prisma.Decimal>;
}

export class UpdateWaqfCauseProjectPlanInput {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  projectPlan?: string;
}

@Injectable()
export class WaqfCausesService {
  // forwardRef on both sides of this pair — WaqfProceedsService now also
  // calls back into this service (allocateProceedsProportionally, fired
  // automatically after every WaqfProceedsService.record(), see that
  // method's own comment), a genuine two-way dependency between these
  // two services/modules.
  private readonly logger = new Logger(WaqfCausesService.name);

  constructor(
    @Inject(forwardRef(() => WaqfProceedsService)) private readonly proceedsService: WaqfProceedsService,
    // Optional so specs constructing this directly needn't wire it; the
    // Nest module always provides it.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Birr-staff path — a one-off custom cause outside the standard
   * catalog (causeCategoryId left null), for a waqf the standard menu
   * doesn't cover. Plain CRUD, not a governed_actions action — a Cause is
   * a theme/purpose within one Waqf Fund's deed, not a separate legal
   * endowment, so it carries none of waqf.create's maker-checker weight.
   * Still audited (unlike the pre-existing gap found in
   * Asset/Beneficiary/Investment/Distribution registration — see the plan
   * this was built from) since CLAUDE.md's audit non-negotiable is about
   * every governed-adjacent write, not just maker-checker ones.
   */
  async create(input: CreateWaqfCauseInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const cause = await tx.waqfCause.create({ data: input });
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_cause.created",
          entityType: "WaqfCause",
          entityId: cause.id,
          after: cause as any,
        },
      });
      return cause;
    });
  }

  /**
   * Founder-Portal path — self-service selection from the standard
   * catalog (see CauseCategoriesService), no Birr staff involvement.
   * name/description are copied from the category at selection time, not
   * looked up live, so a later edit to the category never retroactively
   * rewrites what this waqf already shows (same reasoning as
   * WaqfDeed.deedText). Confirms both that the founder actually owns this
   * waqf and that the category is a real, currently-offered one before
   * writing anything.
   */
  async selectForFounder(waqfId: string, causeCategoryId: string, founderId: string) {
    try {
      return await this.doSelectForFounder(waqfId, causeCategoryId, founderId);
    } catch (err) {
      // Belt-and-suspenders: the restore-if-soft-deleted branch above
      // handles the expected reselect case; this catches anything else
      // that could still collide with @@unique([waqfId, name]) (e.g. a
      // name shared with a Birr-staff-added custom cause) with the same
      // friendly message rather than a raw 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException("This cause is already selected for this waqf.");
      }
      throw err;
    }
  }

  private async doSelectForFounder(waqfId: string, causeCategoryId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) throw new NotFoundException(`Waqf "${waqfId}" not found.`);

      const category = await tx.causeCategory.findFirst({ where: { id: causeCategoryId, deletedAt: null } });
      if (!category) throw new NotFoundException(`CauseCategory "${causeCategoryId}" not found.`);

      const existing = await tx.waqfCause.findFirst({
        where: { waqfId, causeCategoryId, deletedAt: null },
      });
      if (existing) throw new ConflictException("This cause is already selected for this waqf.");

      // A prior select-then-unselect cycle leaves a soft-deleted row
      // still occupying the @@unique([waqfId, name]) slot — WaqfCause is
      // never hard-deleted, so a plain create() here would collide with
      // it. Restore that row (refreshing name/description to the
      // category's current values) instead of inserting a duplicate.
      const previouslySelected = await tx.waqfCause.findFirst({
        where: { waqfId, causeCategoryId, deletedAt: { not: null } },
      });
      // projectPlan is NOT refreshed unconditionally the way name/
      // description are — unlike those, it's independently staff-
      // editable after selection (see updateProjectPlan below), so a
      // staff-authored specific plan must survive an unselect/reselect
      // cycle rather than being silently overwritten back to the
      // category's generic default. Only a row with no plan of its own
      // yet falls back to the category's current default.
      const cause = previouslySelected
        ? await tx.waqfCause.update({
            where: { id: previouslySelected.id },
            data: {
              deletedAt: null,
              name: category.name,
              description: category.description,
              projectPlan: previouslySelected.projectPlan ?? category.projectPlan ?? undefined,
            },
          })
        : await tx.waqfCause.create({
            data: {
              waqfId,
              causeCategoryId,
              name: category.name,
              description: category.description,
              projectPlan: category.projectPlan ?? undefined,
            },
          });
      await tx.auditLog.create({
        data: {
          waqfId,
          actorType: "founder_user",
          // 2026-08-30 security audit fix — was previously missing
          // (see docs/comprehensive-code-review-prompt.md): every other
          // founder_user audit write in this codebase sets
          // actorFounderId, this file was the sole outlier, defeating
          // "who did this" on the audit trail.
          actorFounderId: founderId,
          action: "waqf_cause.selected",
          entityType: "WaqfCause",
          entityId: cause.id,
          before: previouslySelected ? (previouslySelected as any) : undefined,
          after: cause as any,
        },
      });
      return cause;
    });
  }

  /**
   * Founder-Portal path — unselect one of their own catalog-linked
   * causes. Deliberately restricted to causeCategoryId-having rows: a
   * custom cause a Birr staff member registered for this waqf
   * (causeCategoryId null) is staff-managed and stays out of a Founder's
   * reach here, same posture as WaqfsController never letting a Founder
   * session touch governed_actions. Soft-delete, not a hard delete —
   * Beneficiary/Distribution rows may already reference this cause.
   *
   * 2026-11-16 (owner's decisions): removing a cause that has an
   * allocation changes the fund's allocation, so it takes the same
   * primary-contact gate as allocate(), a written reason, and tells the
   * fund's Mutawalli Officer. Only the part never given out is freed:
   * allocationPosition() keeps a removed cause's committed money out of
   * what's available, and DistributionsService.create refuses new
   * distributions on a removed cause.
   */
  async unselectForFounder(
    waqfCauseId: string,
    founderId: string,
    options: { reason?: string; isPrimaryContact?: boolean } = {},
  ): Promise<void> {
    const notice = await withFounderScope(founderId, async (tx) => {
      const found = await tx.waqfCause.findFirst({
        where: { id: waqfCauseId, deletedAt: null, causeCategoryId: { not: null } },
      });
      // Two-step, not a nested `include: { waqf: ... }` — WaqfCause.waqf
      // is a required relation, so if founder_isolation's RLS policy
      // hides the Waqf row from this session (a genuine non-owner),
      // Prisma's client-side referential check throws instead of just
      // resolving the relation to null. A separate top-level query on
      // Waqf degrades gracefully to null when RLS filters it out.
      const owns = found
        ? await tx.waqf.findFirst({
            where: { id: found.waqfId, foundation: { foundationFounders: { some: { founderId } } } },
          })
        : null;
      if (!found || !owns) {
        throw new NotFoundException(`WaqfCause "${waqfCauseId}" not found.`);
      }

      // Same lock order as allocate(): the cause, then the fund.
      await tx.$queryRaw`SELECT id FROM "waqf_causes" WHERE id = ${found.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "waqfs" WHERE id = ${owns.id} FOR NO KEY UPDATE`;
      const cause = await tx.waqfCause.findUniqueOrThrow({ where: { id: found.id } });
      if (cause.deletedAt) throw new NotFoundException(`WaqfCause "${waqfCauseId}" not found.`);

      const allocated = cause.allocatedAmount ?? ZERO;
      const hasAllocation = allocated.gt(0);
      let changeReason: string | undefined;
      if (hasAllocation) {
        if (options.isPrimaryContact === false) {
          throw new ForbiddenException("Only the primary contact for this Foundation can remove a cause that has an allocation.");
        }
        changeReason = requireReason(options.reason, "removing a cause that has an allocation");
      }
      const position = hasAllocation ? await this.allocationPosition(tx, owns) : null;
      const committed = position?.committedByCause.get(cause.id) ?? ZERO;

      const updated = await tx.waqfCause.update({ where: { id: waqfCauseId }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          waqfId: cause.waqfId,
          actorType: "founder_user",
          // 2026-08-30 security audit fix — see selectForFounder's own
          // comment above.
          actorFounderId: founderId,
          action: "waqf_cause.unselected",
          entityType: "WaqfCause",
          entityId: updated.id,
          before: cause as any,
          after: (changeReason ? { ...updated, changeReason } : updated) as any,
        },
      });

      if (!hasAllocation) return null;
      const currency = position?.currency ?? owns.corpusCurrency ?? "NGN";
      const kept = committed.gt(0) ? ` ${moneyText(committed, currency)} of it was already committed to beneficiaries and stays counted.` : "";
      return {
        waqfId: owns.id,
        causeId: cause.id,
        title: `Cause removed with an allocation: ${owns.name}`,
        body: `${cause.name} (${moneyText(allocated, currency)} allocated) was removed.${kept} Founder's reason: "${changeReason}"`,
      };
    });
    if (notice) void this.notifyAllocationChange(notice);
  }

  /**
   * Founder-Portal self-service — earmarks how much of the waqf's
   * distributable pool goes to this cause. Founder self-service, same
   * posture as selecting the cause itself, rather than a governed_action
   * like distribution.approve/investment.change — a deliberate choice
   * (see CLAUDE.md's note on this decision) even though it's a real lever
   * on how much money eventually reaches a cause's beneficiaries.
   * DistributionsService.create() treats allocatedAmount as a real
   * ceiling, not just a declared figure, which is what actually protects
   * against over-committing beyond what's in this pool.
   *
   * The pool is the waqf's live amountRaised (same aggregate as
   * WaqfsService.attachAmountRaised) — the founder's own corpus
   * contributions, regardless of waqf type. This deliberately does NOT
   * draw from WaqfProceeds (investment returns) even for an
   * Investment-type waqf: proceeds are tracked separately, purely for
   * staff performance/compliance reporting, and — historically — played
   * no role in cause allocation at all. That's no longer entirely true:
   * see allocateProceeds() below, a second, Birr-staff-governed pool
   * this method still has nothing to do with. This method's own pool
   * and ceiling (allocatedAmount) stay exactly as they always were.
   *
   * 2026-11-16 (owner's decisions): on an Asset or Project fund an
   * allocation can't go below what's already committed to the cause
   * (pending, approved, disbursing or paid distributions); before this, a
   * founder could lower it and re-allocate the freed amount to another
   * cause, so the causes together could have more committed than was
   * raised. Lowering an allocation needs a written reason and tells the
   * fund's Mutawalli Officer. Raising one, or the first allocation,
   * doesn't.
   */
  async allocate(waqfCauseId: string, founderId: string, amount: string, reason?: string) {
    const outcome = await withFounderScope(founderId, async (tx) => {
      await assertFounderVerified(tx, founderId);

      const found = await tx.waqfCause.findFirst({
        where: { id: waqfCauseId, deletedAt: null, causeCategoryId: { not: null } },
      });
      // Two-step, not a nested `include: { waqf: ... }` — see
      // unselectForFounder's own comment on why a required relation
      // can't be resolved through an RLS-scoped include for ownership
      // checks.
      const waqf = found
        ? await tx.waqf.findFirst({
            where: { id: found.waqfId, foundation: { foundationFounders: { some: { founderId } } } },
          })
        : null;
      if (!found || !waqf) {
        throw new NotFoundException(`WaqfCause "${waqfCauseId}" not found.`);
      }

      const requested = new Prisma.Decimal(amount);
      if (requested.lt(0)) {
        throw new BadRequestException("Allocation can't be negative.");
      }

      // Locks, before any audit row (CLAUDE.md): the cause first, as
      // DistributionsService does when it checks a distribution against
      // this allocation, so lowering it and committing a distribution
      // can't both read the old figures; then the fund, so two calls on
      // *different* sibling causes can't both read the same pre-commit
      // "allocated across other causes" sum and jointly exceed the pool
      // (TOCTOU). NO KEY UPDATE, not UPDATE: it still serializes these
      // calls with each other, without blocking the key-share lock a
      // distribution insert takes on its fund (which, with the cause
      // locked first there, would deadlock).
      await tx.$queryRaw`SELECT id FROM "waqf_causes" WHERE id = ${found.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "waqfs" WHERE id = ${waqf.id} FOR NO KEY UPDATE`;
      const cause = await tx.waqfCause.findUniqueOrThrow({ where: { id: found.id } });
      if (cause.deletedAt) throw new NotFoundException(`WaqfCause "${waqfCauseId}" not found.`);

      const position = await this.allocationPosition(tx, waqf);
      if (position.ambiguousCurrency) {
        throw new BadRequestException(
          "This waqf has confirmed contributions in more than one currency and no declared corpus currency — set a corpus target first so cause allocation has an unambiguous currency to work with.",
        );
      }
      const current = cause.allocatedAmount ?? ZERO;
      const committed = position.committedByCause.get(cause.id) ?? ZERO;
      // What's free for this cause: the pool, less every other active
      // cause's allocation and what removed causes already gave out.
      const available = position.available.plus(maxOf(current, committed));
      if (requested.gt(available)) {
        throw new BadRequestException(`Only ${available} of ${position.raised} raised is unallocated across this waqf's causes.`);
      }
      if (requested.lt(committed)) {
        throw new BadRequestException(
          `${moneyText(committed, position.currency ?? "NGN")} has already been committed to ${cause.name}, so its allocation can't go below that.`,
        );
      }
      const lowering = current.gt(0) && requested.lt(current);
      const changeReason = lowering ? requireReason(reason, "lowering this allocation") : reason?.trim() || undefined;

      const updated = await tx.waqfCause.update({ where: { id: waqfCauseId }, data: { allocatedAmount: amount } });

      await tx.auditLog.create({
        data: {
          waqfId: cause.waqfId,
          actorType: "founder_user",
          // 2026-08-30 security audit fix — see selectForFounder's own
          // comment above. This is the real-money cause-allocation
          // ceiling CLAUDE.md calls out by name; attribution matters
          // most here.
          actorFounderId: founderId,
          action: "waqf_cause.allocation_set",
          entityType: "WaqfCause",
          entityId: updated.id,
          before: cause as any,
          after: (changeReason ? { ...updated, changeReason } : updated) as any,
        },
      });

      const currency = position.currency ?? "NGN";
      return {
        updated,
        notice: lowering
          ? {
              waqfId: waqf.id,
              causeId: cause.id,
              title: `Cause allocation lowered: ${waqf.name}`,
              body: `${cause.name}: ${moneyText(current, currency)} → ${moneyText(requested, currency)}. Founder's reason: "${changeReason}"`,
            }
          : null,
      };
    });
    if (outcome.notice) void this.notifyAllocationChange(outcome.notice);
    return outcome.updated;
  }

  /**
   * Founder-Portal self-service (owner's decision, 2026-11-16): moves part
   * of one cause's allocation to another cause of the same Waqf Fund in
   * one step, so the fund's total allocation never changes and the
   * founder doesn't have to lower one cause and then raise another. On an
   * Asset or Project fund only the part never committed can move. Needs a
   * written reason and tells the fund's Mutawalli Officer.
   */
  async moveAllocation(fromCauseId: string, founderId: string, input: { toCauseId: string; amount: string; reason?: string }) {
    if (fromCauseId === input.toCauseId) {
      throw new BadRequestException("Choose a different cause to move the allocation to.");
    }
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lte(0)) throw new BadRequestException("Enter an amount to move.");
    const changeReason = requireReason(input.reason, "moving this allocation");

    const outcome = await withFounderScope(founderId, async (tx) => {
      await assertFounderVerified(tx, founderId);
      const catalogCause = (id: string) => tx.waqfCause.findFirst({ where: { id, deletedAt: null, causeCategoryId: { not: null } } });
      const [fromFound, toFound] = await Promise.all([catalogCause(fromCauseId), catalogCause(input.toCauseId)]);
      const waqf = fromFound
        ? await tx.waqf.findFirst({
            where: { id: fromFound.waqfId, foundation: { foundationFounders: { some: { founderId } } } },
          })
        : null;
      if (!fromFound || !waqf) throw new NotFoundException(`WaqfCause "${fromCauseId}" not found.`);
      if (!toFound || toFound.waqfId !== waqf.id) throw new NotFoundException(`WaqfCause "${input.toCauseId}" not found.`);

      // Both causes, in id order so two opposite moves can't deadlock,
      // then the fund — the same order as allocate().
      for (const id of [fromFound.id, toFound.id].sort()) {
        await tx.$queryRaw`SELECT id FROM "waqf_causes" WHERE id = ${id} FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT id FROM "waqfs" WHERE id = ${waqf.id} FOR NO KEY UPDATE`;
      const [from, to] = await Promise.all([
        tx.waqfCause.findUniqueOrThrow({ where: { id: fromFound.id } }),
        tx.waqfCause.findUniqueOrThrow({ where: { id: toFound.id } }),
      ]);
      if (from.deletedAt) throw new NotFoundException(`WaqfCause "${fromCauseId}" not found.`);
      if (to.deletedAt) throw new NotFoundException(`WaqfCause "${input.toCauseId}" not found.`);

      const position = await this.allocationPosition(tx, waqf);
      const currency = position.currency ?? waqf.corpusCurrency ?? "NGN";
      const fromAllocated = from.allocatedAmount ?? ZERO;
      const committed = position.committedByCause.get(from.id) ?? ZERO;
      const movable = fromAllocated.minus(committed);
      if (amount.gt(movable)) {
        throw new BadRequestException(
          committed.gt(0)
            ? `Only ${moneyText(movable, currency)} can be moved from ${from.name}: ${moneyText(committed, currency)} of its ${moneyText(fromAllocated, currency)} is already committed.`
            : `Only ${moneyText(movable, currency)} is allocated to ${from.name}.`,
        );
      }

      const toAllocated = to.allocatedAmount ?? ZERO;
      const [fromUpdated, toUpdated] = await Promise.all([
        tx.waqfCause.update({ where: { id: from.id }, data: { allocatedAmount: fromAllocated.minus(amount) } }),
        tx.waqfCause.update({ where: { id: to.id }, data: { allocatedAmount: toAllocated.plus(amount) } }),
      ]);
      const move = { fromCauseId: from.id, toCauseId: to.id, amount: amount.toString(), changeReason };
      for (const [before, after] of [
        [from, fromUpdated],
        [to, toUpdated],
      ] as const) {
        await tx.auditLog.create({
          data: {
            waqfId: waqf.id,
            actorType: "founder_user",
            actorFounderId: founderId,
            action: "waqf_cause.allocation_moved",
            entityType: "WaqfCause",
            entityId: after.id,
            before: before as any,
            after: { ...after, move } as any,
          },
        });
      }

      return {
        from: fromUpdated,
        to: toUpdated,
        notice: {
          waqfId: waqf.id,
          causeId: from.id,
          title: `Cause allocation moved: ${waqf.name}`,
          body: `${moneyText(amount, currency)} moved from ${from.name} to ${to.name}. Founder's reason: "${changeReason}"`,
        },
      };
    });
    void this.notifyAllocationChange(outcome.notice);
    return { from: outcome.from, to: outcome.to };
  }

  /**
   * The founder's view of where their fund's allocation stands, worked
   * out the same way allocate() checks it, so the Founder Portal never
   * computes "unallocated" on its own.
   */
  async allocationSummaryForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
      });
      if (!waqf) return null;
      const position = await this.allocationPosition(tx, waqf);
      return {
        currency: position.currency,
        raised: position.raised.toString(),
        allocated: position.allocatedToActive.toString(),
        heldByRemovedCauses: position.heldByRemovedCauses.toString(),
        available: Prisma.Decimal.max(position.available, 0).toString(),
        appliesFloor: position.appliesFloor,
      };
    });
  }

  /**
   * Where a fund's corpus allocation stands (see AllocationPosition).
   * The pool currency: the waqf's declared corpusCurrency; else the one
   * currency all its confirmed contributions share. Summing raw amounts
   * across currencies previously let, e.g., a fresh USD contribution
   * silently inflate an NGN-denominated pool (2026-08-30 security audit
   * follow-up — see DistributionsService.assertWithinAllocation's own fix
   * comment for the sibling bug this one mirrors), so ambiguous mixing is
   * flagged (ambiguousCurrency) and allocate() refuses it rather than
   * blending.
   *
   * Callers that act on it hold the fund's row lock (and any cause's
   * they change) first.
   */
  private async allocationPosition(
    tx: Prisma.TransactionClient,
    waqf: { id: string; type: string; corpusCurrency: string | null },
  ): Promise<AllocationPosition> {
    const raisedByCurrency = await tx.contribution.groupBy({
      by: ["currency"],
      where: { waqfId: waqf.id, status: "confirmed" },
      _sum: { amount: true },
    });
    let currency = waqf.corpusCurrency;
    let ambiguousCurrency = false;
    if (!currency) {
      const distinct = [...new Set(raisedByCurrency.map((r) => r.currency))];
      ambiguousCurrency = distinct.length > 1;
      currency = ambiguousCurrency ? null : distinct[0] ?? null;
    }
    const raised = currency ? raisedByCurrency.find((r) => r.currency === currency)?._sum.amount ?? ZERO : ZERO;

    const appliesFloor = waqf.type !== "investment";
    const committedByCause = new Map<string, Prisma.Decimal>();
    if (appliesFloor && currency) {
      const committed = await tx.distribution.groupBy({
        by: ["causeId"],
        where: { waqfId: waqf.id, deletedAt: null, currency, status: { in: [...COMMITTED_DISTRIBUTION_STATUSES] } },
        _sum: { amount: true },
      });
      for (const row of committed) committedByCause.set(row.causeId, row._sum.amount ?? ZERO);
    }

    const causes = await tx.waqfCause.findMany({ where: { waqfId: waqf.id }, select: { id: true, allocatedAmount: true, deletedAt: true } });
    let allocatedToActive = ZERO;
    let heldByRemovedCauses = ZERO;
    for (const c of causes) {
      const committed = committedByCause.get(c.id) ?? ZERO;
      if (c.deletedAt) heldByRemovedCauses = heldByRemovedCauses.plus(committed);
      else allocatedToActive = allocatedToActive.plus(maxOf(c.allocatedAmount ?? ZERO, committed));
    }
    return {
      currency,
      ambiguousCurrency,
      raised,
      allocatedToActive,
      heldByRemovedCauses,
      available: raised.minus(allocatedToActive).minus(heldByRemovedCauses),
      appliesFloor,
      committedByCause,
    };
  }

  /**
   * Tells the fund's Mutawalli Officer when a founder lowers, moves or
   * removes an allocation (owner's decision, 2026-11-16): for awareness
   * only, it blocks nothing. The officer assigned to the fund's caseload;
   * if none is, every active Mutawalli Officer. Sent after the change has
   * committed, and a failure is only logged.
   */
  private async notifyAllocationChange(notice: { waqfId: string; causeId: string; title: string; body: string }): Promise<void> {
    if (!this.notifications) return;
    try {
      const assigned = await prisma.waqfCaseAssignment.findMany({
        where: { waqfId: notice.waqfId, status: "active", assignmentRole: "mutawalli_officer", birrStaff: { status: "active" } },
        select: { birrStaff: { select: { userId: true } } },
      });
      let userIds = assigned.map((a) => a.birrStaff.userId);
      if (userIds.length === 0) {
        const officers = await prisma.birrStaff.findMany({
          where: { status: "active", roles: { some: { role: "mutawalli_officer" } } },
          select: { userId: true },
        });
        userIds = officers.map((o) => o.userId);
      }
      await Promise.all(
        [...new Set(userIds)].map((userId) =>
          this.notifications!.notify({
            recipientType: "birr_staff",
            recipientUserId: userId,
            type: "waqf_cause.allocation_changed",
            title: notice.title,
            body: notice.body,
            linkUrl: `/ops/waqfs/${notice.waqfId}`,
            relatedEntityType: "WaqfCause",
            relatedEntityId: notice.causeId,
          }),
        ),
      );
    } catch (err) {
      this.logger.error(`Couldn't tell staff about an allocation change: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Birr-staff path — earmarks how much of the waqf's recorded
   * investment proceeds (WaqfProceedsService.sumForWaqf) goes to this
   * cause. A second, additive pool alongside allocate()'s corpus-based
   * allocatedAmount above — not a replacement for it, and drawing from
   * a completely separate figure — see
   * DistributionsService.assertWithinAllocation, which sums both as
   * the real ceiling.
   *
   * Staff-decided rather than Founder self-service, unlike allocate():
   * a Founder never observes investment performance directly (same
   * trust boundary already drawn around Investment/WaqfProceeds
   * themselves — see WaqfProceedsService.record's own comment), so
   * there's no self-service posture to extend here.
   *
   * Only ever meaningful for an Investment-type waqf, since only that
   * type can have any recorded WaqfProceeds at all
   * (WaqfProceedsService.record rejects every other type) — rejected
   * outright here rather than silently succeeding with a pool of zero,
   * so staff get a clear reason instead of a confusing "nothing
   * available."
   *
   * Deliberately does NOT restrict to causeCategoryId-having causes the
   * way allocate() does: that restriction exists there specifically to
   * keep a Birr-staff custom cause out of Founder reach, which doesn't
   * apply here — this whole method is staff-authored, so a custom cause
   * is exactly as eligible as a catalog one.
   */
  async allocateProceeds(waqfCauseId: string, staffUserId: string, amount: string) {
    return prisma.$transaction(async (tx) => {
      const cause = await tx.waqfCause.findFirst({ where: { id: waqfCauseId, deletedAt: null } });
      if (!cause) throw new NotFoundException(`WaqfCause "${waqfCauseId}" not found.`);

      const waqf = await tx.waqf.findUnique({ where: { id: cause.waqfId } });
      if (!waqf) throw new NotFoundException(`Waqf "${cause.waqfId}" not found.`);
      if (waqf.type !== "investment") {
        throw new BadRequestException(
          `Only Investment-type Waqf Funds have investment proceeds to allocate — "${waqf.name}" is ${waqf.type}.`,
        );
      }

      // Row-locked — same TOCTOU reasoning as allocate()'s own comment,
      // against sibling causes' proceedsAllocatedAmount instead of
      // allocatedAmount.
      await tx.$queryRaw`SELECT id FROM "waqfs" WHERE id = ${waqf.id} FOR UPDATE`;

      // 2026-09-16 codebase audit finding: sumForWaqf() is now
      // currency-scoped (see its own comment — it used to blend every
      // currency together) — resolve which pool this allocation means,
      // same poolCurrency resolution allocate() already does for the
      // corpus side.
      let poolCurrency = waqf.corpusCurrency;
      if (!poolCurrency) {
        const distinctCurrencies = await tx.waqfProceeds.findMany({
          where: { waqfId: cause.waqfId },
          distinct: ["currency"],
          select: { currency: true },
        });
        if (distinctCurrencies.length > 1) {
          throw new BadRequestException(
            `This waqf has recorded proceeds in more than one currency (${distinctCurrencies.map((c) => c.currency).join(", ")}) and no declared corpus currency — set a corpus target first so proceeds allocation has an unambiguous currency to work with.`,
          );
        }
        poolCurrency = distinctCurrencies[0]?.currency ?? null;
      }
      const pool = poolCurrency
        ? await this.proceedsService.sumForWaqf(cause.waqfId, poolCurrency, tx)
        : new Prisma.Decimal(0);

      const otherCauses = await tx.waqfCause.findMany({
        where: { waqfId: cause.waqfId, deletedAt: null, id: { not: waqfCauseId } },
        select: { proceedsAllocatedAmount: true },
      });
      const alreadyAllocated = otherCauses.reduce(
        (sum, c) => sum.plus(c.proceedsAllocatedAmount ?? 0),
        new Prisma.Decimal(0),
      );

      const requested = new Prisma.Decimal(amount);
      if (requested.lt(0)) {
        throw new BadRequestException("Allocation can't be negative.");
      }
      const available = pool.minus(alreadyAllocated);
      if (requested.gt(available)) {
        throw new BadRequestException(
          `Only ${available} of ${pool} recorded proceeds is unallocated across this waqf's causes.`,
        );
      }

      const updated = await tx.waqfCause.update({
        where: { id: waqfCauseId },
        data: { proceedsAllocatedAmount: amount },
      });

      await tx.auditLog.create({
        data: {
          waqfId: cause.waqfId,
          actorType: "birr_staff",
          actorUserId: staffUserId,
          action: "waqf_cause.proceeds_allocation_set",
          entityType: "WaqfCause",
          entityId: updated.id,
          before: cause as any,
          after: updated as any,
        },
      });

      return updated;
    });
  }

  /**
   * Bulk alternative to allocateProceeds() above — instead of staff
   * typing an amount per cause, this auto-computes each cause's share
   * of the waqf's full recorded proceeds pool proportional to its own
   * corpus allocation ratio (allocatedAmount / total corpus allocated
   * across this waqf's causes: N100,000 raised, 60,000/40,000 to Cause
   * A/B → any recorded proceeds split 60%/40% the same way), then sets
   * every cause's proceedsAllocatedAmount in one action. Reuses the
   * exact largest-remainder splitProRata already built for
   * InvestmentPlacementsService.recordProceeds's own pro-rata split —
   * same "sum to the pool exactly, not approximately" requirement
   * applies here.
   *
   * Still staff-triggered, not automatic on every WaqfProceeds record —
   * matches allocateProceeds()'s own staff-decision posture (confirmed
   * with the user: proceeds allocation stays a deliberate Birr-staff
   * action, this just removes the manual per-cause math). Recomputes
   * and OVERWRITES every cause's proceedsAllocatedAmount from the
   * current pool and current corpus ratios each time it's invoked —
   * it doesn't top up incrementally. Re-running it after new proceeds
   * are recorded, or after a corpus allocation changes, is how staff
   * refreshes the split.
   *
   * A cause with no corpus allocation (allocatedAmount null) gets a
   * weight of 0, not excluded — splitProRata handles a 0-weight share
   * correctly (it simply receives 0), so every cause on the waqf still
   * gets an explicit row rather than silently vanishing from the split.
   */
  async allocateProceedsProportionally(waqfId: string, staffUserId: string) {
    return prisma.$transaction(async (tx) => {
      const waqf = await tx.waqf.findUnique({ where: { id: waqfId } });
      if (!waqf) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
      if (waqf.type !== "investment") {
        throw new BadRequestException(
          `Only Investment-type Waqf Funds have investment proceeds to allocate — "${waqf.name}" is ${waqf.type}.`,
        );
      }

      // Row-locked — same TOCTOU reasoning as allocate()'s/allocateProceeds()'s
      // own comments: this overwrites every sibling cause's
      // proceedsAllocatedAmount from the current pool/ratios in one
      // pass, so it must not interleave with a concurrent
      // allocateProceeds()/allocateProceedsProportionally() call
      // touching the same waqf's causes.
      await tx.$queryRaw`SELECT id FROM "waqfs" WHERE id = ${waqfId} FOR UPDATE`;

      const causes = await tx.waqfCause.findMany({ where: { waqfId, deletedAt: null } });
      if (causes.length === 0) {
        throw new BadRequestException("This waqf has no causes to allocate proceeds across.");
      }

      // See allocateProceeds()'s own comment on this same resolution.
      let poolCurrency = waqf.corpusCurrency;
      if (!poolCurrency) {
        const distinctCurrencies = await tx.waqfProceeds.findMany({
          where: { waqfId },
          distinct: ["currency"],
          select: { currency: true },
        });
        if (distinctCurrencies.length > 1) {
          throw new BadRequestException(
            `This waqf has recorded proceeds in more than one currency (${distinctCurrencies.map((c) => c.currency).join(", ")}) and no declared corpus currency — set a corpus target first so proceeds allocation has an unambiguous currency to work with.`,
          );
        }
        poolCurrency = distinctCurrencies[0]?.currency ?? null;
      }
      const pool = poolCurrency ? await this.proceedsService.sumForWaqf(waqfId, poolCurrency, tx) : new Prisma.Decimal(0);
      const shares = splitProRata(
        pool,
        causes.map((c) => ({ key: c.id, weight: c.allocatedAmount ?? new Prisma.Decimal(0) })),
      );

      const updated = [];
      for (const cause of causes) {
        const amount = shares.get(cause.id)!;
        const result = await tx.waqfCause.update({
          where: { id: cause.id },
          data: { proceedsAllocatedAmount: amount },
        });
        updated.push(result);
        await tx.auditLog.create({
          data: {
            waqfId,
            actorType: "birr_staff",
            actorUserId: staffUserId,
            action: "waqf_cause.proceeds_allocated_proportionally",
            entityType: "WaqfCause",
            entityId: cause.id,
            before: cause as any,
            after: result as any,
          },
        });
      }
      return updated;
    });
  }

  /**
   * Birr-staff path — sets or revises this cause's project plan.
   * Plain CRUD, not governed_actions (descriptive content, not a
   * money-moving decision), same trust tier as allocateProceeds()
   * above and mirroring VaultsService.updateCauseProjectPlan exactly.
   * No Founder-scope check — see WaqfCause.projectPlan's own schema
   * comment for why this stays staff-authored, unlike allocate().
   * "Only overwrite whichever field is sent" — undefined leaves the
   * existing value alone.
   */
  async updateProjectPlan(waqfCauseId: string, staffUserId: string, projectPlan: string | undefined) {
    return prisma.$transaction(async (tx) => {
      const cause = await tx.waqfCause.findFirst({ where: { id: waqfCauseId, deletedAt: null } });
      if (!cause) throw new NotFoundException(`WaqfCause "${waqfCauseId}" not found.`);

      const updated = await tx.waqfCause.update({
        where: { id: waqfCauseId },
        data: { projectPlan: projectPlan ?? cause.projectPlan },
      });

      await tx.auditLog.create({
        data: {
          waqfId: cause.waqfId,
          actorType: "birr_staff",
          actorUserId: staffUserId,
          action: "waqf_cause.project_plan_updated",
          entityType: "WaqfCause",
          entityId: updated.id,
          before: { projectPlan: cause.projectPlan } as any,
          after: { projectPlan: updated.projectPlan } as any,
        },
      });

      return updated;
    });
  }

  findById(id: string) {
    return prisma.waqfCause.findUnique({ where: { id } });
  }

  /**
   * `includeInactive` is Ops-only (see the controller — the Founder
   * self-service picker always calls listForFounder, which never sets
   * it): a Beneficiary or Distribution can reference a WaqfCause the
   * founder has since unselected (soft-deleted, not removed — see
   * unselectForFounder's own comment), and staff need that historical
   * row's cause name to resolve correctly for audit/traceability, not
   * show up blank. The catalog-facing "causes currently on this waqf"
   * table stays active-only by omitting the flag.
   */
  list(waqfId: string, includeInactive = false) {
    return prisma.waqfCause.findMany({
      where: { waqfId, ...(includeInactive ? {} : { deletedAt: null }) },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Founder-Portal read path — view-only for staff-added custom causes,
   * select/unselect for catalog-linked ones (see the two methods above).
   * Matches WaqfsService's own findByIdForFounder pattern: confirms the
   * waqf actually belongs to this founder (app-layer WHERE, plus the
   * founder_isolation RLS policy via withFounderScope) before returning
   * anything, and returns null rather than throwing so the controller can
   * 404 — indistinguishable from "id doesn't exist," never confirming
   * another Founder's waqf.
   */
  async listForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true, type: true, corpusCurrency: true },
      });
      if (!waqf) return null;
      // What's already committed to each cause (2026-11-16), so the
      // Founder Portal can show the floor an allocation can't go below.
      // Null on an Investment fund, where corpus isn't what's spent.
      const position = await this.allocationPosition(tx, waqf);
      // Counts (not names — no beneficiary PII crosses into the Founder
      // Portal, same posture as DistributionsService.summaryByCauseForFounder)
      // let the Portal warn before unselecting a cause that already has
      // real beneficiaries/distributions against it, instead of the
      // founder discovering the consequence after the fact. Also
      // pendingNominations — 2026-09-29 codebase walkthrough finding: a
      // founder could unselect a cause with a nomination still sitting
      // in Birr's own review queue for it, with no warning at all, since
      // that queue only ever attaches to a cause, not a Beneficiary row
      // (which wouldn't exist yet). approved/rejected nominations are
      // already covered by resultingBeneficiaryId's own Beneficiary row
      // (approved) or are simply moot (rejected), so this only counts
      // pending ones.
      const causes = await tx.waqfCause.findMany({
        where: { waqfId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              beneficiaries: true,
              distributions: true,
              beneficiaryNominations: { where: { status: "pending" } },
            },
          },
        },
      });
      // Sent as pendingNominations, the name the Founder Portal reads:
      // under Prisma's own name the unselect warning never saw them
      // (found 2026-11-16).
      return causes.map(({ _count, ...cause }) => ({
        ...cause,
        committedAmount: position.appliesFloor ? (position.committedByCause.get(cause.id) ?? ZERO).toString() : null,
        _count: { beneficiaries: _count.beneficiaries, distributions: _count.distributions, pendingNominations: _count.beneficiaryNominations },
      }));
    });
  }
}

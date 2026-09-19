import { BadRequestException, ConflictException, forwardRef, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { assertFounderVerified } from "../../common/auth/current-founder";
import { WaqfProceedsService } from "../waqf-proceeds/waqf-proceeds.service";
import { splitProRata } from "../../common/money/pro-rata";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export class CreateWaqfCauseInput {
  @IsString()
  waqfId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
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
}

@Injectable()
export class WaqfCausesService {
  // forwardRef on both sides of this pair — WaqfProceedsService now also
  // calls back into this service (allocateProceedsProportionally, fired
  // automatically after every WaqfProceedsService.record(), see that
  // method's own comment), a genuine two-way dependency between these
  // two services/modules.
  constructor(
    @Inject(forwardRef(() => WaqfProceedsService)) private readonly proceedsService: WaqfProceedsService,
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
      const cause = previouslySelected
        ? await tx.waqfCause.update({
            where: { id: previouslySelected.id },
            data: { deletedAt: null, name: category.name, description: category.description },
          })
        : await tx.waqfCause.create({
            data: { waqfId, causeCategoryId, name: category.name, description: category.description },
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
   */
  async unselectForFounder(waqfCauseId: string, founderId: string): Promise<void> {
    await withFounderScope(founderId, async (tx) => {
      const cause = await tx.waqfCause.findFirst({
        where: { id: waqfCauseId, deletedAt: null, causeCategoryId: { not: null } },
      });
      // Two-step, not a nested `include: { waqf: ... }` — WaqfCause.waqf
      // is a required relation, so if founder_isolation's RLS policy
      // hides the Waqf row from this session (a genuine non-owner),
      // Prisma's client-side referential check throws instead of just
      // resolving the relation to null. A separate top-level query on
      // Waqf degrades gracefully to null when RLS filters it out.
      const owns = cause
        ? await tx.waqf.findFirst({
            where: { id: cause.waqfId, foundation: { foundationFounders: { some: { founderId } } } },
          })
        : null;
      if (!cause || !owns) {
        throw new NotFoundException(`WaqfCause "${waqfCauseId}" not found.`);
      }

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
          after: updated as any,
        },
      });
    });
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
   */
  async allocate(waqfCauseId: string, founderId: string, amount: string) {
    return withFounderScope(founderId, async (tx) => {
      await assertFounderVerified(tx, founderId);

      const cause = await tx.waqfCause.findFirst({
        where: { id: waqfCauseId, deletedAt: null, causeCategoryId: { not: null } },
      });
      // Two-step, not a nested `include: { waqf: ... }` — see
      // unselectForFounder's own comment on why a required relation
      // can't be resolved through an RLS-scoped include for ownership
      // checks.
      const waqf = cause
        ? await tx.waqf.findFirst({
            where: { id: cause.waqfId, foundation: { foundationFounders: { some: { founderId } } } },
          })
        : null;
      if (!cause || !waqf) {
        throw new NotFoundException(`WaqfCause "${waqfCauseId}" not found.`);
      }

      // Row-locked for the rest of this transaction so two concurrent
      // allocate() calls against *different* sibling causes on this same
      // waqf can't both read the same pre-commit "already allocated
      // across other causes" sum below and jointly exceed the waqf's
      // raised pool (TOCTOU) — locking just this one cause's own row
      // wouldn't stop that, since the ceiling spans every cause on the
      // waqf.
      await tx.$queryRaw`SELECT id FROM "waqfs" WHERE id = ${waqf.id} FOR UPDATE`;

      // Scoped to a single currency — Contribution.currency exists
      // per-row (a waqf can receive contributions in more than one
      // currency), but this pool and every WaqfCause.allocatedAmount it
      // gets compared against carry no currency of their own. Summing
      // raw amounts across currencies here previously let, e.g., a
      // fresh USD contribution silently inflate an NGN-denominated
      // allocatable pool (2026-08-30 security audit follow-up — see
      // docs/comprehensive-code-review-prompt.md and
      // DistributionsService.assertWithinAllocation's own fix comment
      // for the sibling bug this one mirrors). Prefer the waqf's own
      // declared corpusCurrency as the canonical currency; if none is
      // declared (legacy waqfs predating the corpus-target feature),
      // fall back to requiring every confirmed contribution to already
      // be in one single currency — ambiguous mixing is refused outright
      // rather than silently blended.
      const raisedByCurrency = await tx.contribution.groupBy({
        by: ["currency"],
        where: { waqfId: cause.waqfId, status: "confirmed" },
        _sum: { amount: true },
      });
      let poolCurrency = waqf.corpusCurrency;
      if (!poolCurrency) {
        const distinctCurrencies = new Set(raisedByCurrency.map((r) => r.currency));
        if (distinctCurrencies.size > 1) {
          throw new BadRequestException(
            `This waqf has confirmed contributions in more than one currency (${[...distinctCurrencies].join(", ")}) and no declared corpus currency — set a corpus target first so cause allocation has an unambiguous currency to work with.`,
          );
        }
        poolCurrency = [...distinctCurrencies][0] ?? null;
      }
      const pool = poolCurrency
        ? raisedByCurrency.find((r) => r.currency === poolCurrency)?._sum.amount ?? new Prisma.Decimal(0)
        : new Prisma.Decimal(0);

      const otherCauses = await tx.waqfCause.findMany({
        where: { waqfId: cause.waqfId, deletedAt: null, id: { not: waqfCauseId } },
        select: { allocatedAmount: true },
      });
      const alreadyAllocated = otherCauses.reduce(
        (sum, c) => sum.plus(c.allocatedAmount ?? 0),
        new Prisma.Decimal(0),
      );

      const requested = new Prisma.Decimal(amount);
      if (requested.lt(0)) {
        throw new BadRequestException("Allocation can't be negative.");
      }
      const available = pool.minus(alreadyAllocated);
      if (requested.gt(available)) {
        throw new BadRequestException(
          `Only ${available} of ${pool} raised is unallocated across this waqf's causes.`,
        );
      }

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
          after: updated as any,
        },
      });

      return updated;
    });
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
        select: { id: true },
      });
      if (!waqf) return null;
      // Counts (not names — no beneficiary PII crosses into the Founder
      // Portal, same posture as DistributionsService.summaryByCauseForFounder)
      // let the Portal warn before unselecting a cause that already has
      // real beneficiaries/distributions against it, instead of the
      // founder discovering the consequence after the fact.
      return tx.waqfCause.findMany({
        where: { waqfId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { beneficiaries: true, distributions: true } } },
      });
    });
  }
}

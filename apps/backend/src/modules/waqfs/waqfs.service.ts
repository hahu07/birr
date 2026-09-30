import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma, WaqfType, WaqfFundingPlan } from "@birr/db";
import { assertFounderVerified } from "../../common/auth/current-founder";
import { withFounderScope } from "../../common/db/founder-scope";
import { TrusteeLicensesService } from "../trustee-licenses/trustee-licenses.service";
import { NotificationsService } from "../notifications/notifications.service";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { FunnelEventsService } from "../funnel-events/funnel-events.service";

export class CreateWaqfInput {
  @IsString()
  name!: string;

  @IsEnum(WaqfType)
  type!: WaqfType;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsString()
  jurisdiction!: string;

  @IsString()
  foundationId!: string;

  // The declared total endowment target — required for every new
  // establishment (see CorpusMinimum, checked in create() below); a
  // waqf created before this feature existed just has these columns
  // null, not backfilled.
  @IsNumberString()
  @IsPositiveDecimal()
  corpusAmount!: string;

  @IsString()
  corpusCurrency!: string;

  @IsEnum(WaqfFundingPlan)
  fundingPlan!: WaqfFundingPlan;
}

// Raising the declared endowment target itself — deliberately a
// separate action from ContributionsService.initiate() (paying toward
// the *existing* target). Conflating the two would let a bigger
// contribution silently redefine what the founder originally pledged;
// this only ever moves corpusAmount up, never touches amountRaised
// (still computed live from confirmed Contributions, see
// attachAmountRaised).
export class IncreaseCorpusTargetInput {
  @IsNumberString()
  @IsPositiveDecimal()
  corpusAmount!: string;
}

@Injectable()
export class WaqfsService {
  private readonly logger = new Logger(WaqfsService.name);

  constructor(
    private readonly trusteeLicenses: TrusteeLicensesService,
    private readonly notificationsService: NotificationsService,
    private readonly funnelEvents: FunnelEventsService,
  ) {}

  /**
   * Core creation logic, transactional — shared by createSelfService()
   * below. Not exposed directly behind a controller route: every public
   * caller goes through createSelfService() so the ownership check
   * always runs first.
   *
   * A Waqf's founder relationship is derived transitively via
   * foundationId -> foundation_founders -> founderId (see
   * foundations/foundations.service.ts) — a Waqf without a foundationId
   * would be invisible to the founder_isolation RLS policy
   * (packages/db/prisma/migrations/20260802211506_drop_waqf_founders_and_rewrite_founder_isolation)
   * for anyone but Birr's own (unscoped) backend connection, which is
   * exactly why foundationId is a required (NOT NULL) FK, not optional.
   */
  async create(input: CreateWaqfInput, tx: Prisma.TransactionClient) {
    const foundation = await tx.foundation.findUnique({
      where: { id: input.foundationId },
    });
    if (!foundation) {
      throw new NotFoundException(`Unknown foundation id: ${input.foundationId}`);
    }

    // Same lookup-and-compare shape as ContributionsService.initiate()'s
    // ContributionMinimum check — this is the total-corpus floor, a
    // separate admin-configurable table from that one (see
    // CorpusMinimum's own schema comment for why they're not merged).
    const minimum = await tx.corpusMinimum.findUnique({ where: { currency: input.corpusCurrency } });
    if (!minimum) {
      throw new BadRequestException(`No minimum corpus is configured for currency "${input.corpusCurrency}".`);
    }
    if (new Prisma.Decimal(input.corpusAmount).lt(minimum.minAmount)) {
      throw new BadRequestException(
        `The minimum waqf corpus for ${input.corpusCurrency} is ${minimum.minAmount}. Please increase the amount.`,
      );
    }

    return tx.waqf.create({
      data: {
        name: input.name,
        type: input.type,
        purpose: input.purpose,
        jurisdiction: input.jurisdiction,
        foundationId: input.foundationId,
        corpusAmount: input.corpusAmount,
        corpusCurrency: input.corpusCurrency,
        fundingPlan: input.fundingPlan,
      },
    });
  }

  /**
   * Self-service Waqf Fund establishment — a donor creates it directly,
   * live immediately, no maker-checker gate. The act of creating it is
   * how the donor agrees Birr becomes Mutawalli over it; ongoing
   * governance (asset disposal, distributions, investment changes,
   * beneficiary-criteria changes) stays exclusively Birr-staff-mediated
   * through governed_actions, unchanged.
   *
   * The ownership check below — the Foundation must actually belong to
   * the calling founder, via the same foundationFounders join the RLS
   * policy already uses — is the security-critical line here: without
   * it, any founder could create a waqf under any other founder's
   * Foundation just by guessing/enumerating a foundationId.
   */
  async createSelfService(input: CreateWaqfInput & { founderId: string }) {
    // Routed through withFounderScope (2026-08-31 codebase audit finding)
    // — the ownership check just below was already correct on its own,
    // but without the RLS session var set, the founder_isolation policy
    // was a silent no-op on this write, leaving only one of the two
    // independent enforcement layers CLAUDE.md calls for actually engaged.
    const waqf = await withFounderScope(input.founderId, async (tx) => {
      await assertFounderVerified(tx, input.founderId);

      const foundation = await tx.foundation.findFirst({
        where: { id: input.foundationId, foundationFounders: { some: { founderId: input.founderId } } },
      });
      if (!foundation) {
        throw new ForbiddenException("This foundation doesn't belong to you.");
      }

      const waqf = await this.create(input, tx);

      await tx.auditLog.create({
        data: {
          actorType: "founder_user",
          actorFounderId: input.founderId,
          action: "waqf.created",
          entityType: "Waqf",
          entityId: waqf.id,
          after: waqf as any,
        },
      });

      return waqf;
    });

    // Best-effort — record() never throws.
    void this.funnelEvents.record({
      funnel: "founder",
      step: "waqf_fund_created",
      sessionId: input.founderId,
      founderId: input.founderId,
      waqfId: waqf.id,
    });

    // No RolePermission row exists for "who may assign caseloads" (this
    // isn't a governed_actions permission — see
    // WaqfCaseAssignmentsController's own comment) and no staff role is
    // otherwise authoritative here, so this targets platform_admin as
    // the de-facto ops/triage role — same judgment call as
    // CauseCategorySuggestionsService's "new suggestion pending" and
    // TrusteeLicensesService's write-gate role. Deliberately not
    // awaited, same posture as every other post-transaction notify()
    // fan-out this session.
    this.notifyPlatformAdminsOfNewWaqf(waqf.id, waqf.name).catch((err) => {
      this.logger.error(
        `Failed to notify platform_admin of new waqf "${waqf.id}":`,
        err instanceof Error ? err.stack : String(err),
      );
    });

    return waqf;
  }

  private async notifyPlatformAdminsOfNewWaqf(waqfId: string, waqfName: string): Promise<void> {
    const admins = await prisma.birrStaff.findMany({
      where: { staffRole: "platform_admin", status: "active" },
      select: { userId: true },
    });
    await Promise.all(
      admins.map((admin) =>
        this.notificationsService.notify({
          recipientType: "birr_staff",
          recipientUserId: admin.userId,
          type: "waqf.needs_case_assignment",
          title: "New Waqf Fund needs a case owner",
          body: `"${waqfName}" was established and has no case assignment yet.`,
          linkUrl: `/ops/waqfs/${waqfId}`,
          relatedEntityType: "Waqf",
          relatedEntityId: waqfId,
        }),
      ),
    );
  }

  /**
   * Founder-Portal self-service — raises this waqf's own declared
   * corpus target, on the same "no Birr staff, no approval gate"
   * footing as establishment itself (see createSelfService's own
   * comment): a founder pledging *more* of their own money is not asset
   * disposal, a distribution, an investment change, or a
   * beneficiary-criteria change, so it stays outside governed_actions.
   * Strictly upward only, checked against the current target (not just
   * amountRaised) — lowering a declared target is a materially
   * different, more consequential action (walking back a public
   * commitment) that this method deliberately does not support.
   */
  async increaseCorpusTarget(waqfId: string, founderId: string, newCorpusAmount: string) {
    // Routed through withFounderScope — see createSelfService's own
    // comment on this same fix (2026-08-31 codebase audit finding).
    return withFounderScope(founderId, async (tx) => {
      await assertFounderVerified(tx, founderId);

      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
      });
      if (!waqf) throw new NotFoundException(`Waqf "${waqfId}" not found.`);

      if (waqf.status === "dissolved") {
        throw new BadRequestException("This waqf fund is dissolved — its corpus target can no longer be changed.");
      }
      if (waqf.corpusAmount === null) {
        throw new BadRequestException("This waqf fund predates corpus targets and has none to increase.");
      }
      if (!new Prisma.Decimal(newCorpusAmount).gt(waqf.corpusAmount)) {
        throw new BadRequestException(
          `The new corpus target must be greater than the current target (${waqf.corpusCurrency} ${waqf.corpusAmount}).`,
        );
      }

      const updated = await tx.waqf.update({ where: { id: waqfId }, data: { corpusAmount: newCorpusAmount } });

      await tx.auditLog.create({
        data: {
          waqfId,
          actorType: "founder_user",
          actorFounderId: founderId,
          action: "waqf.corpus_target_increased",
          entityType: "Waqf",
          entityId: waqfId,
          before: waqf as any,
          after: updated as any,
        },
      });

      return updated;
    });
  }

  async findById(id: string) {
    // Founder Portal's Waqf Fund detail page (app/portfolio/[id]) needs
    // the Foundation it belongs to for its "Part of {foundation.name}"
    // context line — purely additive, same as list()'s existing include.
    // foundation.foundationDeed lets any caller read whether Birr's
    // trustee appointment over this waqf's Foundation has been signed
    // (deed-signing is Foundation-level, not per-Waqf — see
    // FoundationDeed's own schema comment). waqfDeed is still included
    // too, for any historical per-Waqf deed predating that change.
    const waqf = await prisma.waqf.findUnique({ where: { id }, include: { foundation: { include: { foundationDeed: true } }, waqfDeed: true } });
    if (!waqf) return waqf;
    return this.attachAmountRaised(await this.withTrusteeLicenseStatus(waqf));
  }

  /**
   * Flags, never blocks — see TrusteeLicense's own schema comment.
   * Additive field on the response so the Ops Console (and, if it ever
   * wants to, the Founder Portal) can surface it without a second
   * round-trip; nothing in the create path checks or reacts to it.
   */
  private async withTrusteeLicenseStatus<T extends { jurisdiction: string }>(waqf: T) {
    const trusteeLicenseStatus = await this.trusteeLicenses.statusForJurisdiction(waqf.jurisdiction);
    return { ...waqf, trusteeLicenseStatus };
  }

  /**
   * Computed, not stored — a running total of confirmed Contributions
   * would drift the moment it's cached anywhere, so this sums on read
   * every time instead of denormalizing onto the Waqf row. Additive
   * field, same posture as withTrusteeLicenseStatus above.
   */
  private async attachAmountRaised<T extends { id: string; corpusCurrency: string | null }>(waqf: T) {
    // Scoped to the waqf's declared corpus currency (when set — every
    // waqf created through createSelfService has one) so a stray
    // off-currency Contribution can never blend into this total the way
    // a plain unscoped sum would. ContributionsService.initiate() now
    // rejects a mismatched currency on every payment, not just the
    // first, so this filter should be a no-op in practice — kept as an
    // independent second check on the read side, same reasoning as the
    // corpus-floor currency check it mirrors.
    const result = await prisma.contribution.aggregate({
      where: {
        waqfId: waqf.id,
        status: "confirmed",
        ...(waqf.corpusCurrency ? { currency: waqf.corpusCurrency } : {}),
      },
      _sum: { amount: true },
    });
    return { ...waqf, amountRaised: (result._sum.amount ?? new Prisma.Decimal(0)).toString() };
  }

  /**
   * Founder-session-scoped counterpart to findById() — used by
   * WaqfsController.findById() when a Founder Portal session is
   * present, so a signed-in Founder can't read another Founder's waqf
   * by id. Same withFounderScope pattern as list(): the app-layer WHERE
   * clause and the founder_isolation RLS policy are both genuinely
   * scoped to founderId for this request, not just the WHERE clause
   * alone. Returns null (not throw) on no match — the controller turns
   * that into a 404, deliberately indistinguishable from "id doesn't
   * exist at all."
   */
  async findByIdForFounder(id: string, founderId: string) {
    const waqf = await withFounderScope(founderId, (tx) =>
      tx.waqf.findFirst({
        where: { id, foundation: { foundationFounders: { some: { founderId } } } },
        include: { foundation: { include: { foundationDeed: true } }, waqfDeed: true },
      }),
    );
    return waqf ? this.attachAmountRaised(waqf) : waqf;
  }

  /**
   * CLAUDE.md's 13 "Waqf lifecycle stages" — purely computed, never
   * persisted, same "derive live from real rows, no lifecycle_stage
   * column, no cron job" shape as FoundersService.getOnboardingStatus.
   * Unlike onboarding, these stages aren't sequential/gated in reality
   * (a fund can have beneficiaries before its first compliance policy
   * match), so this returns a checklist + completion count, not a
   * single "current stage."
   *
   * Three non-"complete" states, not a plain boolean:
   *  - "pending": trackable, hasn't happened yet.
   *  - "not_applicable": can never happen for this waqf (e.g.
   *    investment management on a non-investment-type fund — Investments
   *    can only ever exist for type: investment, per
   *    InvestmentsService.createOne()'s own guard).
   *  - "not_available": explicitly deferred pending an unresolved
   *    design fork (succession management only — see
   *    docs/succession-and-preservation.md's 2026-08-30 policy
   *    decision: who's allowed to initiate a primary_contact handoff,
   *    and whether it needs its own maker-checker gate, is still open;
   *    do not compute anything real here without that answer first).
   *    Financial reporting and long-term preservation used to live here
   *    too — financial reporting until FinancialReportsService shipped
   *    (now checked for real), long-term preservation until the same
   *    2026-08-30 decision resolved it as structurally satisfied by
   *    existing non-negotiables (now always "complete", not deferred).
   */
  async getLifecycleStatus(waqfId: string) {
    const waqf = await prisma.waqf.findUnique({
      where: { id: waqfId },
      include: { foundation: { include: { foundationDeed: true } } },
    });
    if (!waqf) return null;

    const [assetCount, activeAssignments, investmentCount, beneficiaryCount, paidDistributionCount, policySet, impactUpdateCount, auditLogCount, financialReportCount] =
      await Promise.all([
        prisma.asset.count({ where: { waqfId, deletedAt: null } }),
        prisma.waqfCaseAssignment.findMany({ where: { waqfId, status: "active" }, select: { assignmentRole: true } }),
        prisma.investment.count({ where: { waqfId } }),
        prisma.beneficiary.count({ where: { waqfId, deletedAt: null } }),
        prisma.distribution.count({ where: { waqfId, status: "paid", deletedAt: null } }),
        prisma.compliancePolicySet.findUnique({ where: { jurisdiction: waqf.jurisdiction } }),
        prisma.causeImpactUpdate.count({ where: { waqfCause: { waqfId } } }),
        prisma.auditLog.count({ where: { waqfId } }),
        // Generating a FinancialReportsService.generate() report writes
        // this exact action — same "check real audit_logs rows" pattern
        // as audit itself, and doubles as the source of truth once a
        // financial report has actually been pulled at least once.
        prisma.auditLog.count({ where: { waqfId, action: "financial_report.exported" } }),
      ]);

    const stages = {
      establishment: { status: "complete" as const, completedAt: waqf.createdAt },
      legalDocumentation: {
        status: (waqf.foundation.foundationDeed ? "complete" : "pending") as "complete" | "pending",
        signedAt: waqf.foundation.foundationDeed?.signedAt ?? null,
      },
      assetRegistration: { status: (assetCount > 0 ? "complete" : "pending") as "complete" | "pending", count: assetCount },
      governanceConfiguration: {
        status: (activeAssignments.length > 0 ? "complete" : "pending") as "complete" | "pending",
        assignmentRoles: activeAssignments.map((a) => a.assignmentRole),
      },
      investmentManagement:
        waqf.type !== "investment"
          ? { status: "not_applicable" as const, count: undefined as number | undefined }
          : { status: (investmentCount > 0 ? "complete" : "pending") as "complete" | "pending", count: investmentCount },
      beneficiaryAdministration: {
        status: (beneficiaryCount > 0 ? "complete" : "pending") as "complete" | "pending",
        count: beneficiaryCount,
      },
      distributionManagement: {
        status: (paidDistributionCount > 0 ? "complete" : "pending") as "complete" | "pending",
        count: paidDistributionCount,
      },
      complianceMonitoring: {
        status: (policySet ? "complete" : "pending") as "complete" | "pending",
        frameworkName: policySet?.frameworkName ?? null,
      },
      financialReporting: {
        status: (financialReportCount > 0 ? "complete" : "pending") as "complete" | "pending",
        count: financialReportCount,
      },
      impactMeasurement: {
        status: (impactUpdateCount > 0 ? "complete" : "pending") as "complete" | "pending",
        count: impactUpdateCount,
      },
      audit: { status: (auditLogCount > 0 ? "complete" : "pending") as "complete" | "pending", count: auditLogCount },
      // Still not_available — the owner's 2026-08-30 going-concern
      // decision (see docs/succession-and-preservation.md) narrowed
      // this to a real, buildable Founder-side scope (reassigning
      // primary_contact when the current holder is gone), but who's
      // allowed to initiate it and whether it needs its own
      // maker-checker gate is still an open design fork — nothing to
      // compute here yet.
      successionManagement: { status: "not_available" as const },
      // Always complete, unconditionally — resolved, not deferred, by
      // the same 2026-08-30 decision: under a going-concern assumption,
      // "preservation independent of Birr's own existence" isn't a live
      // risk to engineer around, and what CLAUDE.md's non-negotiables
      // already guarantee (audit_logs is insert-only at the DB role
      // level; WaqfDeed/FoundationDeed are DB-trigger-immutable once
      // signed) already *is* the preservation mechanism for every waqf,
      // not something a specific waqf can be missing.
      longTermPreservation: { status: "complete" as const },
    };

    const trackable = Object.values(stages).filter((s) => s.status !== "not_applicable" && s.status !== "not_available");
    const completedCount = trackable.filter((s) => s.status === "complete").length;

    return { waqfId, stages, completedCount, trackableCount: trackable.length };
  }

  /**
   * When founderId is given, this also sets the app.current_founder_id
   * session variable that founder_isolation
   * (packages/db/prisma/migrations/20260802211506_drop_waqf_founders_and_rewrite_founder_isolation)
   * reads — so the WHERE clause below (app-layer) and the RLS policy
   * (DB-layer) are both genuinely enforcing the same scope for this
   * request, not just the WHERE clause alone. The founder relationship
   * is transitive via foundationId -> foundation_founders, not a direct
   * join table.
   */
  // causesCount rides along (active WaqfCause selections/registrations,
  // same shape as CauseCategoriesService.list()'s usageCount) so the Ops
  // Console's grouped-by-Foundation list can show it without an extra
  // round trip per waqf.
  // type/search are an ops filtering convenience (e.g. the Investment
  // Placements bulk-select flow searching across every Investment-type
  // Waqf Fund without pulling the whole table) — not a security
  // boundary, same trust level as founderId's existing "ops callers are
  // trusted already" comment above. search matches on the fund's own
  // name or its Foundation's name, case-insensitively, since an officer
  // may only remember one or the other.
  async list(founderId?: string, filter?: { type?: string; search?: string }) {
    const type = filter?.type && Object.values(WaqfType).includes(filter.type as WaqfType) ? (filter.type as WaqfType) : undefined;
    const search = filter?.search?.trim();
    const searchWhere = search
      ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { foundation: { name: { contains: search, mode: "insensitive" as const } } }] }
      : {};

    // Only capped when type/search actually narrow the query (this new
    // search use case) — checked against the resolved values, not just
    // whether a filter object was passed. The controller always passes
    // `{ type, search }` (even both undefined) on every HTTP call, so
    // gating on the object's mere presence would silently cap every
    // plain GET /waqfs — including the Waqf Funds list page, which
    // expects to see every waqf — at 50 rows.
    const take = type || search ? 50 : undefined;

    if (!founderId) {
      // Same reasoning as FoundationsService.list() — a Waqf whose own
      // WaqfDeed (or its Foundation's FoundationDeed) blocks hard-delete
      // can still end up orphaned (its Foundation has zero linked
      // Founders). Excluded so the Ops Console list/Overview never
      // counts a deed-locked husk as a fund Birr actually manages.
      const waqfs = await prisma.waqf.findMany({
        where: { foundation: { foundationFounders: { some: {} } }, ...(type ? { type } : {}), ...searchWhere },
        include: { foundation: { include: { foundationDeed: true } }, _count: { select: { waqfCauses: { where: { deletedAt: null } } } } },
        orderBy: { createdAt: "desc" },
        take,
      });
      return waqfs.map(({ _count, ...waqf }) => ({ ...waqf, causesCount: _count.waqfCauses }));
    }
    return withFounderScope(founderId, async (tx) => {
      const waqfs = await tx.waqf.findMany({
        where: { foundation: { foundationFounders: { some: { founderId } } }, ...(type ? { type } : {}), ...searchWhere },
        include: { foundation: { include: { foundationDeed: true } }, _count: { select: { waqfCauses: { where: { deletedAt: null } } } } },
        orderBy: { createdAt: "desc" },
        take,
      });
      return waqfs.map(({ _count, ...waqf }) => ({ ...waqf, causesCount: _count.waqfCauses }));
    });
  }
}

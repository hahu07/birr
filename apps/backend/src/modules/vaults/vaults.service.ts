import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsArray, IsEnum, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { prisma, Prisma, VaultType, VaultStatus } from "@birr/db";
import { VaultProceedsService } from "./vault-proceeds.service";
import { VaultLedgerService } from "./vault-ledger.service";
import { findVaultOrThrow } from "./find-vault-or-throw";
import { SPENDABLE_CONTRIBUTION_WHERE } from "./spendable-contributions";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

// Lowercase letters/digits/hyphens only, no leading/trailing/double
// hyphen — the public donation page URL (/vaults/:slug), so it needs to
// read cleanly wherever it's shared, not just be technically valid.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CreateVaultInput {
  @IsString()
  name!: string;

  @Matches(SLUG_PATTERN, {
    message: "slug must be lowercase letters, digits, and single hyphens only (e.g. \"ramadan-relief-2026\").",
  })
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(VaultType)
  type!: VaultType;

  @IsString()
  currency!: string;

  // Other currencies this vault also accepts for giving, beyond
  // `currency` above — see Vault.additionalCurrencies's own schema
  // comment for what this does and does not extend to in this first
  // slice (contributions only, not targetAmount/allocation/payouts).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  additionalCurrencies?: string[];

  @IsString()
  jurisdiction!: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;
}

export class UpdateVaultStatusInput {
  @IsEnum(VaultStatus)
  status!: VaultStatus;
}

export class UpdateVaultFeasibilityReportInput {
  @IsOptional()
  @IsString()
  title?: string;
}

export class CreateVaultCauseInput {
  @IsString()
  vaultId!: string;

  @IsOptional()
  @IsString()
  causeCategoryId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // See VaultCause.projectPlan's own schema comment — cause-specific,
  // unlike Vault.feasibilityReportUrl. A real bound (unlike `description`
  // above, which has none — a separate pre-existing gap, not fixed here),
  // matching CauseCategoriesService's own MaxLength convention.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  projectPlan?: string;
}

export class UpdateVaultCauseProjectPlanInput {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  projectPlan?: string;
}

// Every VaultStatus transition a staff member may trigger directly via
// PATCH /vaults/:id/status. archived is deliberately reachable only from
// closed — a vault shouldn't disappear from "currently running" history
// straight from open, so a staff member can't skip the "no longer
// accepting new contributions but still visible/disbursing" step by
// mistake. draft -> open is deliberately NOT here — see publish() below:
// unlike every other transition, that one requires the governed
// vault.publish action, not a single staff member acting alone.
const ALLOWED_STATUS_TRANSITIONS: Record<VaultStatus, VaultStatus[]> = {
  draft: [],
  open: ["closed"],
  closed: ["open", "archived"],
  archived: [],
};

@Injectable()
export class VaultsService {
  constructor(
    private readonly vaultProceedsService: VaultProceedsService,
    private readonly ledger: VaultLedgerService,
  ) {}

  /**
   * Birr-staff path — plain CRUD, not a governed_actions action, same
   * trust level as WaqfCausesService.create()'s own custom-cause
   * registration. Starts at status: draft — see publish() below for how
   * it later becomes visible/public (a governed action, unlike this).
   */
  async create(input: CreateVaultInput, actorUserId: string) {
    // Dedupe against the primary currency and against itself — a
    // currency listed as "additional" when it's already the primary
    // one is meaningless, not a real second option to give in.
    const additionalCurrencies = [...new Set(input.additionalCurrencies ?? [])].filter((c) => c !== input.currency);
    try {
      return await prisma.$transaction(async (tx) => {
        const vault = await tx.vault.create({ data: { ...input, additionalCurrencies, createdByUserId: actorUserId } });
        await tx.auditLog.create({
          data: {
            actorType: "birr_staff",
            actorUserId,
            action: "vault.created",
            entityType: "Vault",
            entityId: vault.id,
            after: vault as any,
          },
        });
        return vault;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException(`The slug "${input.slug}" is already in use by another vault.`);
      }
      throw err;
    }
  }

  /**
   * Plain staff CRUD, same trust level as create() above — draft -> open
   * is deliberately excluded (see ALLOWED_STATUS_TRANSITIONS's own
   * comment and publish() below). See that same comment for why
   * archived is only reachable from closed, not open.
   */
  async updateStatus(id: string, newStatus: VaultStatus, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const vault = await findVaultOrThrow(tx, id);

      if (!ALLOWED_STATUS_TRANSITIONS[vault.status].includes(newStatus)) {
        const allowed = ALLOWED_STATUS_TRANSITIONS[vault.status];
        const guidance =
          vault.status === "draft"
            ? 'propose the "Publish" governed action instead'
            : allowed.length > 0
              ? `it can only move to one of: ${allowed.join(", ")}`
              : "this is a terminal status";
        throw new BadRequestException(`Vault "${vault.name}" is "${vault.status}" — ${guidance}.`);
      }

      const updated = await tx.vault.update({
        where: { id },
        data: {
          status: newStatus,
          openedAt: newStatus === "open" && !vault.openedAt ? new Date() : undefined,
          closedAt: newStatus === "closed" ? new Date() : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "vault.status_changed",
          entityType: "Vault",
          entityId: updated.id,
          before: vault as any,
          after: updated as any,
        },
      });

      return updated;
    });
  }

  /**
   * Internal only — never exposed behind a public controller route.
   * vault.publish is a governed action; the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction. draft -> open is the moment Birr's brand starts
   * soliciting public money for a named cause — unlike every other
   * status transition (closing, reopening, archiving an already-vetted,
   * previously-public vault), a vault's very first publish requires
   * maker-checker sign-off rather than one staff member acting alone.
   * Raised directly with the owner as a gap the original design flagged
   * but left open for v1; closed at their explicit direction
   * (2026-09-11).
   */
  async publish(id: string, tx: Prisma.TransactionClient) {
    const vault = await findVaultOrThrow(tx, id);
    if (vault.status !== "draft") {
      throw new BadRequestException(`Vault "${vault.name}" is "${vault.status}", not "draft" — nothing to publish.`);
    }

    return tx.vault.update({ where: { id }, data: { status: "open", openedAt: new Date() } });
  }

  /**
   * Staff-only, plain CRUD (not governed) — same trust level as
   * updateStatus() above. A separate call rather than folded into
   * create()/an update-vault endpoint: a cover is meant to be added or
   * replaced any time after creation, not only at creation, mirroring
   * how message attachments and Foundation logos are also their own
   * upload path rather than baked into one combined form everywhere.
   */
  async setCoverImage(id: string, coverImageUrl: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const vault = await findVaultOrThrow(tx, id);

      const updated = await tx.vault.update({ where: { id }, data: { coverImageUrl } });

      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "vault.cover_updated",
          entityType: "Vault",
          entityId: updated.id,
          before: { coverImageUrl: vault.coverImageUrl } as any,
          after: { coverImageUrl: updated.coverImageUrl } as any,
        },
      });

      return updated;
    });
  }

  /**
   * Staff-only, plain CRUD (not governed) — same trust level as
   * setCoverImage() above. Deliberately allows either field alone
   * (updating just the title, or just re-uploading the file) rather
   * than requiring both together, mirroring VaultMilestonesService
   * .setEvidence()'s own "only overwrite whichever field is actually
   * sent" reasoning. Unlike milestone evidence, this is public the
   * moment it's set — see Vault.feasibilityReportUrl's own schema
   * comment on why.
   */
  async setFeasibilityReport(id: string, input: { title?: string; url?: string }, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const vault = await findVaultOrThrow(tx, id);

      const updated = await tx.vault.update({
        where: { id },
        data: {
          feasibilityReportTitle: input.title ?? vault.feasibilityReportTitle,
          feasibilityReportUrl: input.url ?? vault.feasibilityReportUrl,
        },
      });

      await tx.auditLog.create({
        data: {
          vaultId: id,
          actorType: "birr_staff",
          actorUserId,
          action: "vault.feasibility_report_updated",
          entityType: "Vault",
          entityId: updated.id,
          before: { feasibilityReportTitle: vault.feasibilityReportTitle, feasibilityReportUrl: vault.feasibilityReportUrl } as any,
          after: { feasibilityReportTitle: updated.feasibilityReportTitle, feasibilityReportUrl: updated.feasibilityReportUrl } as any,
        },
      });

      return updated;
    });
  }

  findById(id: string) {
    return prisma.vault.findFirst({
      where: { id, deletedAt: null },
      include: { causes: { where: { deletedAt: null }, include: { allocations: true } } },
    });
  }

  // Field whitelist for the two @Public() routes below — a public
  // visitor's browser gets exactly what apps/web/lib/types.ts's Vault/
  // VaultCause interfaces declare, never the staff-only fields on the
  // same rows (createdByUserId identifies a staff member;
  // VaultCauseAllocation's own allocatedAmount/proceedsAllocatedAmount
  // are governed-action-gated internal ceilings, deliberately not
  // included in this cause's own `select` below) — findById/list below
  // stay on `include` since those two routes are staff-only (no
  // @Public()).
  private static readonly PUBLIC_VAULT_SELECT = {
    id: true,
    name: true,
    slug: true,
    description: true,
    type: true,
    // Not part of the public Vault type in apps/web/lib/types.ts, but
    // needed here so findBySlug's own not-open check (below) still
    // compiles/works — harmless to include, a vault's status is already
    // implied by which list it showed up in.
    status: true,
    currency: true,
    additionalCurrencies: true,
    targetAmount: true,
    jurisdiction: true,
    coverImageUrl: true,
    // Deliberately public, unlike milestone evidence — see
    // Vault.feasibilityReportUrl's own schema comment: this is a
    // donor's own due-diligence material, not staff-internal proof.
    feasibilityReportUrl: true,
    feasibilityReportTitle: true,
    causes: {
      where: { deletedAt: null },
      select: {
        id: true,
        vaultId: true,
        causeCategoryId: true,
        name: true,
        description: true,
        projectPlan: true,
        // Only the catalog row's `icon` — never its projectPlan/
        // projectPlanFileUrl, which are staff reference material by
        // design (see CauseCategory's own schema comments). Flattened to
        // a bare `icon` on the cause by publicCause() below, so the
        // public payload keeps the shape apps/web/lib/types.ts declares
        // rather than growing a nested relation. A one-off custom cause
        // has no category at all, hence null.
        causeCategory: { select: { icon: true } },
      },
    },
    // Update, 2026-09-14 — evidenceNotes/evidenceFileUrl are public too:
    // the whole point of photographing/documenting completed work is
    // showing the donor who actually paid for it, per the owner's
    // explicit direction. targetAmount stays excluded — a budget figure,
    // not proof of anything, no reason given to change that one.
    milestones: {
      where: { deletedAt: null },
      orderBy: { sequence: "asc" },
      select: { id: true, name: true, sequence: true, status: true, evidenceNotes: true, evidenceFileUrl: true },
    },
  } as const;

  /**
   * Collapses the nested causeCategory relation PUBLIC_VAULT_SELECT
   * joins in down to the bare `icon` the donation page actually renders.
   */
  private static publicCause<C extends { causeCategory: { icon: string | null } | null }>(cause: C) {
    const { causeCategory, ...rest } = cause;
    return { ...rest, icon: causeCategory?.icon ?? null };
  }

  async findBySlug(slug: string) {
    const found = await prisma.vault.findFirst({ where: { slug, deletedAt: null }, select: VaultsService.PUBLIC_VAULT_SELECT });
    if (!found) return null;
    const vault = { ...found, causes: found.causes.map(VaultsService.publicCause) };
    const [withRaised] = await this.withAmountRaised([vault]);
    // Real committed program spend, per currency — the one already-
    // public-safe figure the Program Expenses ledger account gives for
    // free (see VaultLedgerService.spentByCurrency's own comment). Only
    // on the detail page's single-vault lookup, not the /vaults index
    // or homepage teaser grid — a donor deciding whether to give to
    // THIS vault benefits from seeing real spend against it; a grid of
    // many vault cards doesn't need the extra query per card.
    const spentSoFar = await this.ledger.spentByCurrency(withRaised.id);
    return { ...withRaised, causes: await this.withCauseAmountRaised(withRaised.causes), spentSoFar };
  }

  /**
   * Per-cause counterpart to withAmountRaised below — how much each
   * cause on this vault has actually been given, so the donation page can
   * show a donor which cause the campaign's gifts have gone to rather
   * than only the vault-wide total.
   *
   * Same SPENDABLE_CONTRIBUTION_WHERE filter and same group-by-currency
   * posture as the vault-level sum (never converted or added across
   * currencies), so the two figures can't disagree about what counts as
   * raised. A cause's total is NOT a share of the vault's: a gift with no
   * vaultCauseId ("wherever it's needed most") belongs to no cause, so
   * the causes' totals legitimately sum to less than the vault's.
   *
   * Only wired into findBySlug, not listOpen — same reasoning as
   * spentSoFar above: the detail page is where a donor picks between
   * causes; a grid of vault cards doesn't show per-cause figures.
   */
  private async withCauseAmountRaised<C extends { id: string }>(
    causes: C[],
  ): Promise<(C & { amountRaised: { currency: string; amount: string }[] })[]> {
    if (causes.length === 0) return [];
    const sums = await prisma.vaultContribution.groupBy({
      by: ["vaultCauseId", "currency"],
      where: { vaultCauseId: { in: causes.map((c) => c.id) }, ...SPENDABLE_CONTRIBUTION_WHERE },
      _sum: { amount: true },
    });
    const raisedByCauseId = new Map<string, { currency: string; amount: string }[]>();
    for (const s of sums) {
      if (!s.vaultCauseId) continue;
      const list = raisedByCauseId.get(s.vaultCauseId) ?? [];
      list.push({ currency: s.currency, amount: s._sum.amount?.toString() ?? "0" });
      raisedByCauseId.set(s.vaultCauseId, list);
    }
    return causes.map((c) => ({ ...c, amountRaised: raisedByCauseId.get(c.id) ?? [] }));
  }

  /**
   * Batches a "how much has this vault actually raised" sum onto each
   * row — Prisma has no built-in way to express a related model's SUM
   * inside a `select`/`include`, so this runs as one grouped aggregate
   * query alongside the main one rather than N+1 per-vault queries.
   * Confirmed contributions only.
   *
   * Grouped by currency, not summed into one figure — since
   * Vault.additionalCurrencies (2026-09-13), a vault can accept gifts in
   * more than one currency, and there's no meaningful way to add e.g.
   * USD and NGN totals together without a live exchange-rate
   * conversion this codebase deliberately doesn't take on (same
   * "compare each currency on its own terms, never convert" posture
   * VaultContributionsService.findOrCreateDonor's AML check already
   * takes). Callers show each currency's own raised total separately.
   */
  private async withAmountRaised<T extends { id: string }>(
    vaults: T[],
  ): Promise<(T & { amountRaised: { currency: string; amount: string }[] })[]> {
    if (vaults.length === 0) return [];
    const sums = await prisma.vaultContribution.groupBy({
      by: ["vaultId", "currency"],
      where: { vaultId: { in: vaults.map((v) => v.id) }, ...SPENDABLE_CONTRIBUTION_WHERE },
      _sum: { amount: true },
    });
    const raisedByVaultId = new Map<string, { currency: string; amount: string }[]>();
    for (const s of sums) {
      const list = raisedByVaultId.get(s.vaultId) ?? [];
      list.push({ currency: s.currency, amount: s._sum.amount?.toString() ?? "0" });
      raisedByVaultId.set(s.vaultId, list);
    }
    return vaults.map((v) => ({ ...v, amountRaised: raisedByVaultId.get(v.id) ?? [] }));
  }

  /**
   * Ops Console listing — every non-deleted vault regardless of status,
   * so staff can see drafts/closed/archived ones too, not just what's
   * currently public.
   */
  list() {
    return prisma.vault.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
  }

  /**
   * Public-listing path (a later slice's controller calls this) —
   * status: open only, no draft/closed/archived leakage to an
   * unauthenticated visitor.
   */
  // Includes causes for the same reason findById/findBySlug do — this
  // is the list a public page (the homepage's own teaser grid, and the
  // dedicated /vaults index) renders cards from, and GET /vaults/:id
  // /causes is staff-only, not something an unauthenticated visitor's
  // page can call per vault to fill them in afterward.
  async listOpen() {
    const vaults = await prisma.vault.findMany({
      where: { status: "open", deletedAt: null },
      select: VaultsService.PUBLIC_VAULT_SELECT,
      orderBy: { openedAt: "desc" },
    });
    // Icon flattened here too, so a cause has the same shape whichever
    // public route served it — but no per-cause amountRaised (see
    // withCauseAmountRaised's own comment on why that's detail-page-only).
    return this.withAmountRaised(vaults.map((v) => ({ ...v, causes: v.causes.map(VaultsService.publicCause) })));
  }

  /**
   * Birr-staff path — a one-off custom cause, or a pick from the shared
   * CauseCategory catalog (see WaqfCausesService.create()/
   * selectForFounder()'s own comments for the identical two-shape
   * convention this mirrors). allocatedAmount/proceedsAllocatedAmount
   * intentionally don't exist yet on VaultCause — they land in the
   * governed-action slice (see schema.prisma's own comment on this
   * model).
   */
  async createCause(input: CreateVaultCauseInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      await findVaultOrThrow(tx, input.vaultId);

      let name = input.name;
      let description = input.description;
      let projectPlan = input.projectPlan;
      if (input.causeCategoryId) {
        const category = await tx.causeCategory.findFirst({ where: { id: input.causeCategoryId, deletedAt: null } });
        if (!category) throw new NotFoundException(`CauseCategory "${input.causeCategoryId}" not found.`);
        // Copied at selection time, not looked up live — same reasoning
        // as WaqfCause: a later edit to the category shouldn't
        // retroactively rewrite what this vault already shows.
        name = name ?? category.name;
        description = description ?? category.description ?? undefined;
        // The category's own projectPlan is only ever a default
        // TEMPLATE (see its own schema comment) — an explicit
        // input.projectPlan always wins; this just fills the gap when
        // staff didn't type one, so they're not retyping the same
        // boilerplate every time they pick a commonly-used category.
        projectPlan = projectPlan ?? category.projectPlan ?? undefined;
      }
      if (!name) {
        throw new BadRequestException("A vault cause needs a name, either supplied directly or via causeCategoryId.");
      }

      let cause;
      try {
        cause = await tx.vaultCause.create({
          data: { vaultId: input.vaultId, causeCategoryId: input.causeCategoryId, name, description, projectPlan },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
          throw new ConflictException(`This vault already has a cause named "${name}".`);
        }
        throw err;
      }

      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "vault_cause.created",
          entityType: "VaultCause",
          entityId: cause.id,
          after: cause as any,
        },
      });

      return cause;
    });
  }

  listCauses(vaultId: string) {
    return prisma.vaultCause.findMany({
      where: { vaultId, deletedAt: null },
      include: { allocations: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Plain staff CRUD, same trust tier as setFeasibilityReport above —
   * descriptive content, not a money-moving governed action. The only
   * update path a VaultCause has at all today; deliberately scoped to
   * just this one field rather than a general rename/re-describe
   * endpoint, since that's not what was asked for and isn't needed yet.
   * "Only overwrite whichever field is actually sent" — undefined leaves
   * the existing value alone, same as setFeasibilityReport.
   */
  async updateCauseProjectPlan(id: string, input: { projectPlan?: string }, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const cause = await tx.vaultCause.findFirst({ where: { id, deletedAt: null } });
      if (!cause) throw new NotFoundException(`VaultCause "${id}" not found.`);

      const updated = await tx.vaultCause.update({
        where: { id },
        data: { projectPlan: input.projectPlan ?? cause.projectPlan },
      });

      await tx.auditLog.create({
        data: {
          vaultId: cause.vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: "vault_cause.project_plan_updated",
          entityType: "VaultCause",
          entityId: updated.id,
          before: { projectPlan: cause.projectPlan } as any,
          after: { projectPlan: updated.projectPlan } as any,
        },
      });

      return updated;
    });
  }

  /**
   * Internal only — never exposed behind a public controller route.
   * vault.cause_allocate is a governed action; the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction. Mirrors WaqfCausesService.allocate()'s own ceiling
   * logic (pool = confirmed VaultContribution total, minus what's
   * already allocated to sibling causes on this vault) but is
   * governed here rather than Founder self-service — there's no Founder
   * to hold that half of the decision for a Vault (see this section's
   * own top comment), and it's public money.
   *
   * Update, 2026-09-15: allocation is now per-currency
   * (VaultCauseAllocation, one row per (vaultCauseId, currency)) — a
   * vault with additionalCurrencies can allocate each currency's raised
   * pool independently to the same set of causes, rather than every
   * cause sharing one bare, primary-currency-only ceiling.
   */
  async setCauseAllocation(
    vaultCauseId: string,
    currency: string,
    newAllocatedAmount: Prisma.Decimal | number | string,
    tx: Prisma.TransactionClient,
  ) {
    const cause = await tx.vaultCause.findFirst({ where: { id: vaultCauseId, deletedAt: null } });
    if (!cause) throw new NotFoundException(`VaultCause "${vaultCauseId}" not found.`);

    // Row-locked — same TOCTOU reasoning as WaqfCausesService.allocate's
    // own comment: two concurrent allocations against different sibling
    // causes on this vault can't both read the same pre-commit sum.
    await tx.$queryRaw`SELECT id FROM "vaults" WHERE id = ${cause.vaultId} FOR UPDATE`;
    const vault = await tx.vault.findUniqueOrThrow({ where: { id: cause.vaultId } });

    const acceptedCurrencies = [vault.currency, ...vault.additionalCurrencies];
    if (!acceptedCurrencies.includes(currency)) {
      throw new BadRequestException(`This vault only accepts contributions in ${acceptedCurrencies.join(", ")}, not ${currency}.`);
    }

    const raised = await tx.vaultContribution.aggregate({
      where: { vaultId: cause.vaultId, currency, ...SPENDABLE_CONTRIBUTION_WHERE },
      _sum: { amount: true },
    });
    const pool = raised._sum.amount ?? new Prisma.Decimal(0);

    const otherAllocations = await tx.vaultCauseAllocation.findMany({
      where: { currency, vaultCause: { vaultId: cause.vaultId, deletedAt: null }, vaultCauseId: { not: vaultCauseId } },
      select: { allocatedAmount: true },
    });
    const alreadyAllocated = otherAllocations.reduce((sum, a) => sum.plus(a.allocatedAmount), new Prisma.Decimal(0));

    const requested = new Prisma.Decimal(newAllocatedAmount);
    if (requested.lt(0)) throw new BadRequestException("Allocation can't be negative.");
    const available = pool.minus(alreadyAllocated);
    if (requested.gt(available)) {
      throw new BadRequestException(`Only ${available} ${currency} of ${pool} ${currency} raised is unallocated across this vault's causes.`);
    }

    return tx.vaultCauseAllocation.upsert({
      where: { vaultCauseId_currency: { vaultCauseId, currency } },
      create: { vaultCauseId, currency, allocatedAmount: newAllocatedAmount },
      update: { allocatedAmount: newAllocatedAmount },
    });
  }

  /**
   * Investment-style vaults only — internal only, same governed-action-
   * only posture as setCauseAllocation above. Mirrors
   * WaqfCausesService.allocateProceeds()'s own ceiling logic, pool
   * sourced from VaultProceedsService.sumForVault instead of
   * WaqfProceedsService.sumForWaqf.
   *
   * Update, 2026-09-15: per-currency, same reasoning as
   * setCauseAllocation above.
   */
  async setCauseProceedsAllocation(
    vaultCauseId: string,
    currency: string,
    newProceedsAllocatedAmount: Prisma.Decimal | number | string,
    tx: Prisma.TransactionClient,
  ) {
    const cause = await tx.vaultCause.findFirst({ where: { id: vaultCauseId, deletedAt: null } });
    if (!cause) throw new NotFoundException(`VaultCause "${vaultCauseId}" not found.`);

    const vault = await tx.vault.findUniqueOrThrow({ where: { id: cause.vaultId } });
    if (vault.type !== "investment") {
      throw new BadRequestException(
        `Only investment-style vaults have investment proceeds to allocate — "${vault.name}" is ${vault.type}.`,
      );
    }
    const acceptedCurrencies = [vault.currency, ...vault.additionalCurrencies];
    if (!acceptedCurrencies.includes(currency)) {
      throw new BadRequestException(`This vault only accepts proceeds in ${acceptedCurrencies.join(", ")}, not ${currency}.`);
    }

    await tx.$queryRaw`SELECT id FROM "vaults" WHERE id = ${vault.id} FOR UPDATE`;
    const pool = await this.vaultProceedsService.sumForVault(vault.id, currency, tx);

    const otherAllocations = await tx.vaultCauseAllocation.findMany({
      where: { currency, vaultCause: { vaultId: vault.id, deletedAt: null }, vaultCauseId: { not: vaultCauseId } },
      select: { proceedsAllocatedAmount: true },
    });
    const alreadyAllocated = otherAllocations.reduce(
      (sum, a) => sum.plus(a.proceedsAllocatedAmount),
      new Prisma.Decimal(0),
    );

    const requested = new Prisma.Decimal(newProceedsAllocatedAmount);
    if (requested.lt(0)) throw new BadRequestException("Allocation can't be negative.");
    const available = pool.minus(alreadyAllocated);
    if (requested.gt(available)) {
      throw new BadRequestException(
        `Only ${available} ${currency} of ${pool} ${currency} recorded proceeds is unallocated across this vault's causes.`,
      );
    }

    return tx.vaultCauseAllocation.upsert({
      where: { vaultCauseId_currency: { vaultCauseId, currency } },
      create: { vaultCauseId, currency, proceedsAllocatedAmount: newProceedsAllocatedAmount },
      update: { proceedsAllocatedAmount: newProceedsAllocatedAmount },
    });
  }
}

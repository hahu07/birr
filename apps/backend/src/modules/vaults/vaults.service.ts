import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsOptional, IsString, Matches } from "class-validator";
import { prisma, Prisma, VaultType, VaultStatus } from "@birr/db";
import { VaultProceedsService } from "./vault-proceeds.service";

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
  constructor(private readonly vaultProceedsService: VaultProceedsService) {}

  /**
   * Birr-staff path — plain CRUD, not a governed_actions action, same
   * trust level as WaqfCausesService.create()'s own custom-cause
   * registration. Starts at status: draft — see publish() below for how
   * it later becomes visible/public (a governed action, unlike this).
   */
  async create(input: CreateVaultInput, actorUserId: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const vault = await tx.vault.create({ data: { ...input, createdByUserId: actorUserId } });
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
      const vault = await tx.vault.findFirst({ where: { id, deletedAt: null } });
      if (!vault) throw new NotFoundException(`Vault "${id}" not found.`);

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
    const vault = await tx.vault.findFirst({ where: { id, deletedAt: null } });
    if (!vault) throw new NotFoundException(`Vault "${id}" not found.`);
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
      const vault = await tx.vault.findFirst({ where: { id, deletedAt: null } });
      if (!vault) throw new NotFoundException(`Vault "${id}" not found.`);

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

  findById(id: string) {
    return prisma.vault.findFirst({ where: { id, deletedAt: null }, include: { causes: { where: { deletedAt: null } } } });
  }

  findBySlug(slug: string) {
    return prisma.vault.findFirst({ where: { slug, deletedAt: null }, include: { causes: { where: { deletedAt: null } } } });
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
  listOpen() {
    return prisma.vault.findMany({
      where: { status: "open", deletedAt: null },
      include: { causes: { where: { deletedAt: null } } },
      orderBy: { openedAt: "desc" },
    });
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
      const vault = await tx.vault.findFirst({ where: { id: input.vaultId, deletedAt: null } });
      if (!vault) throw new NotFoundException(`Vault "${input.vaultId}" not found.`);

      let name = input.name;
      let description = input.description;
      if (input.causeCategoryId) {
        const category = await tx.causeCategory.findFirst({ where: { id: input.causeCategoryId, deletedAt: null } });
        if (!category) throw new NotFoundException(`CauseCategory "${input.causeCategoryId}" not found.`);
        // Copied at selection time, not looked up live — same reasoning
        // as WaqfCause: a later edit to the category shouldn't
        // retroactively rewrite what this vault already shows.
        name = name ?? category.name;
        description = description ?? category.description ?? undefined;
      }
      if (!name) {
        throw new BadRequestException("A vault cause needs a name, either supplied directly or via causeCategoryId.");
      }

      let cause;
      try {
        cause = await tx.vaultCause.create({
          data: { vaultId: input.vaultId, causeCategoryId: input.causeCategoryId, name, description },
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
    return prisma.vaultCause.findMany({ where: { vaultId, deletedAt: null }, orderBy: { createdAt: "desc" } });
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
   */
  async setCauseAllocation(vaultCauseId: string, newAllocatedAmount: Prisma.Decimal | number | string, tx: Prisma.TransactionClient) {
    const cause = await tx.vaultCause.findFirst({ where: { id: vaultCauseId, deletedAt: null } });
    if (!cause) throw new NotFoundException(`VaultCause "${vaultCauseId}" not found.`);

    // Row-locked — same TOCTOU reasoning as WaqfCausesService.allocate's
    // own comment: two concurrent allocations against different sibling
    // causes on this vault can't both read the same pre-commit sum.
    await tx.$queryRaw`SELECT id FROM "vaults" WHERE id = ${cause.vaultId} FOR UPDATE`;
    const vault = await tx.vault.findUniqueOrThrow({ where: { id: cause.vaultId } });

    const raised = await tx.vaultContribution.aggregate({
      where: { vaultId: cause.vaultId, currency: vault.currency, status: "confirmed" },
      _sum: { amount: true },
    });
    const pool = raised._sum.amount ?? new Prisma.Decimal(0);

    const otherCauses = await tx.vaultCause.findMany({
      where: { vaultId: cause.vaultId, deletedAt: null, id: { not: vaultCauseId } },
      select: { allocatedAmount: true },
    });
    const alreadyAllocated = otherCauses.reduce((sum, c) => sum.plus(c.allocatedAmount ?? 0), new Prisma.Decimal(0));

    const requested = new Prisma.Decimal(newAllocatedAmount);
    if (requested.lt(0)) throw new BadRequestException("Allocation can't be negative.");
    const available = pool.minus(alreadyAllocated);
    if (requested.gt(available)) {
      throw new BadRequestException(`Only ${available} of ${pool} raised is unallocated across this vault's causes.`);
    }

    return tx.vaultCause.update({ where: { id: vaultCauseId }, data: { allocatedAmount: newAllocatedAmount } });
  }

  /**
   * Investment-style vaults only — internal only, same governed-action-
   * only posture as setCauseAllocation above. Mirrors
   * WaqfCausesService.allocateProceeds()'s own ceiling logic, pool
   * sourced from VaultProceedsService.sumForVault instead of
   * WaqfProceedsService.sumForWaqf.
   */
  async setCauseProceedsAllocation(
    vaultCauseId: string,
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

    await tx.$queryRaw`SELECT id FROM "vaults" WHERE id = ${vault.id} FOR UPDATE`;
    const pool = await this.vaultProceedsService.sumForVault(vault.id, tx);

    const otherCauses = await tx.vaultCause.findMany({
      where: { vaultId: vault.id, deletedAt: null, id: { not: vaultCauseId } },
      select: { proceedsAllocatedAmount: true },
    });
    const alreadyAllocated = otherCauses.reduce(
      (sum, c) => sum.plus(c.proceedsAllocatedAmount ?? 0),
      new Prisma.Decimal(0),
    );

    const requested = new Prisma.Decimal(newProceedsAllocatedAmount);
    if (requested.lt(0)) throw new BadRequestException("Allocation can't be negative.");
    const available = pool.minus(alreadyAllocated);
    if (requested.gt(available)) {
      throw new BadRequestException(`Only ${available} of ${pool} recorded proceeds is unallocated across this vault's causes.`);
    }

    return tx.vaultCause.update({ where: { id: vaultCauseId }, data: { proceedsAllocatedAmount: newProceedsAllocatedAmount } });
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsIn, IsObject, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { Prisma, prisma, ZakahMadhhab, ZakahMetalPrice, ZakahRuleset as ZakahRulesetRow } from "@birr/db";
import {
  PRICES_EXPIRED_AFTER_DAYS,
  priceFreshness,
  validateRulings,
  ZakahInputError,
  type MetalPrices,
  type PriceFreshness,
  type ZakahRuleset,
  type ZakahRulings,
} from "@birr/zakah";

const MADHHABS: ZakahMadhhab[] = ["maliki", "hanafi", "shafii", "hanbali"];
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A blunt sanity ceiling on a per-gram price, same spirit as MaxDecimal —
// far above any real gold price, low enough to catch an extra few zeros.
const MAX_PRICE_PER_GRAM = new Prisma.Decimal("100000000");

export class CreateZakahRulesetInput {
  @Matches(/^[a-z0-9][a-z0-9-]{1,48}$/, { message: "key must be 2-49 lowercase letters, digits or hyphens, e.g. \"maliki\"." })
  key!: string;

  @IsIn(MADHHABS)
  madhhab!: ZakahMadhhab;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  // Shape checked by @birr/zakah's validateRulings, the same check the
  // calculator itself runs.
  @IsObject()
  rulings!: unknown;
}

export class UpdateZakahRulesetDraftInput {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  @IsObject()
  rulings!: unknown;
}

/** zakah.ruleset_approve's payload: a snapshot of exactly what the checker is asked to approve. */
export interface RulesetApprovalPayload {
  rulesetId: string;
  label: string;
  rulings: ZakahRulings;
}

/** zakah.metal_price_set's payload. */
export interface MetalPricePayload {
  goldPerGram: string;
  silverPerGram: string;
  asOf: string;
  source: string;
}

export interface CurrentMetalPrices extends MetalPrices {
  freshness: PriceFreshness;
}

/** Today's date in Nigeria, where Birr operates (UTC+1, no daylight saving). */
export function lagosToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now);
}

function toRulings(field: string, raw: unknown): ZakahRulings {
  try {
    return validateRulings(raw);
  } catch (err) {
    if (err instanceof ZakahInputError) throw new BadRequestException(`${field}: ${err.message}`);
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toPackageRuleset(row: ZakahRulesetRow): ZakahRuleset {
  return {
    id: row.key,
    version: row.version,
    madhhab: row.madhhab,
    label: row.label,
    approval:
      row.status === "draft"
        ? { status: "draft" }
        : { status: "approved", approvedAt: isoDate(row.approvedAt!), governedActionId: row.approvedGovernedActionId! },
    rulings: validateRulings(row.rulings),
  };
}

function toMetalPrices(row: ZakahMetalPrice): MetalPrices {
  return {
    // toFixed(), not toString(): a Decimal's toString() can switch to
    // exponent notation, which @birr/zakah rightly refuses.
    goldPerGram: row.goldPerGram.toFixed(),
    silverPerGram: row.silverPerGram.toFixed(),
    asOf: isoDate(row.asOf),
    source: row.source,
  };
}

/**
 * Zakah's two staff-controlled inputs: the rulesets the calculator
 * applies and the metal prices that fix the nisab. Both only take effect
 * through a governed action (zakah.ruleset_approve, zakah.metal_price_set
 * — see GovernedActionsService); this service holds the rules those
 * handlers call, plus drafting and the public reads.
 */
@Injectable()
export class ZakahService {
  /** Replaced in tests, so they can date prices far from real ones. */
  now: () => Date = () => new Date();

  private today(): string {
    return lagosToday(this.now());
  }

  // ---- Rulesets ----

  listRulesets() {
    return prisma.zakahRuleset.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });
  }

  /** What the public calculator offers: the live version of every ruleset. */
  async listCurrentRulesets(): Promise<ZakahRuleset[]> {
    const rows = await prisma.zakahRuleset.findMany({ where: { status: "approved" }, orderBy: { key: "asc" } });
    return rows.map(toPackageRuleset);
  }

  async createDraft(input: CreateZakahRulesetInput, actorUserId: string) {
    const rulings = toRulings("rulings", input.rulings);
    const label = input.label.trim();
    try {
      return await prisma.$transaction(async (tx) => {
        const latest = await tx.zakahRuleset.findFirst({ where: { key: input.key }, orderBy: { version: "desc" } });
        if (latest?.status === "draft") {
          throw new ConflictException(`"${input.key}" already has a draft (version ${latest.version}) — edit that one instead.`);
        }
        if (latest && latest.madhhab !== input.madhhab) {
          throw new BadRequestException(`"${input.key}" is a ${latest.madhhab} ruleset; a new version can't change its madhhab.`);
        }
        const created = await tx.zakahRuleset.create({
          data: {
            key: input.key,
            madhhab: input.madhhab,
            version: (latest?.version ?? 0) + 1,
            label,
            rulings: rulings as unknown as Prisma.InputJsonValue,
            createdByUserId: actorUserId,
          },
        });
        await tx.auditLog.create({
          data: {
            actorType: "birr_staff",
            actorUserId,
            action: "zakah_ruleset.drafted",
            entityType: "ZakahRuleset",
            entityId: created.id,
            after: created as any,
          },
        });
        return created;
      });
    } catch (err) {
      // Two drafts racing past the check above: the database's
      // one-draft-per-key / (key, version) indexes stop the second.
      if (isUniqueViolation(err)) {
        throw new ConflictException(`"${input.key}" already has a draft — reload and edit that one instead.`);
      }
      throw err;
    }
  }

  async updateDraft(id: string, input: UpdateZakahRulesetDraftInput, actorUserId: string) {
    const rulings = toRulings("rulings", input.rulings);
    const label = input.label.trim();
    return prisma.$transaction(async (tx) => {
      const before = await tx.zakahRuleset.findUnique({ where: { id } });
      if (!before) throw new NotFoundException(`Zakah ruleset "${id}" not found.`);
      if (before.status !== "draft") {
        throw new BadRequestException(`Version ${before.version} of "${before.key}" is ${before.status} and can't be edited — draft a new version instead.`);
      }
      if (await this.pendingApproval(id, tx)) {
        throw new ConflictException(
          "This draft is waiting for Shariah approval. Ask the board to reject that proposal before editing it.",
        );
      }
      const updated = await tx.zakahRuleset.update({
        where: { id },
        data: { label, rulings: rulings as unknown as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "zakah_ruleset.draft_updated",
          entityType: "ZakahRuleset",
          entityId: id,
          before: before as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  private async pendingApproval(rulesetId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
    return db.governedAction.findFirst({
      where: {
        status: "proposed",
        permission: { key: "zakah.ruleset_approve" },
        payload: { path: ["rulesetId"], equals: rulesetId },
      },
    });
  }

  /** zakah.ruleset_approve, propose-time. */
  async validateRulesetProposal(payload: unknown): Promise<RulesetApprovalPayload> {
    const { rulesetId, label, rulings } = (payload ?? {}) as Partial<RulesetApprovalPayload>;
    if (typeof rulesetId !== "string") throw new BadRequestException("payload.rulesetId is required.");
    const ruleset = await prisma.zakahRuleset.findUnique({ where: { id: rulesetId } });
    if (!ruleset) throw new NotFoundException(`Zakah ruleset "${rulesetId}" not found.`);
    if (ruleset.status !== "draft") {
      throw new BadRequestException(`Version ${ruleset.version} of "${ruleset.key}" is already ${ruleset.status}.`);
    }
    this.assertSnapshotMatches(ruleset, { rulesetId, label, rulings });
    return { rulesetId, label: ruleset.label, rulings: validateRulings(ruleset.rulings) };
  }

  async checkDuplicateRulesetProposal(payload: unknown) {
    const { rulesetId } = payload as RulesetApprovalPayload;
    if (await this.pendingApproval(rulesetId)) {
      throw new ConflictException("This draft is already waiting for Shariah approval — check the Approvals queue.");
    }
  }

  /**
   * The proposal carries the label and rulings the proposer saw, so the
   * checker approves exactly that — never a draft edited in between.
   */
  private assertSnapshotMatches(ruleset: ZakahRulesetRow, payload: Partial<RulesetApprovalPayload>) {
    let snapshot: ZakahRulings;
    try {
      snapshot = validateRulings(payload.rulings);
    } catch {
      throw new BadRequestException("payload.rulings must be the draft's rulings exactly as shown.");
    }
    const same =
      payload.label === ruleset.label && JSON.stringify(snapshot) === JSON.stringify(validateRulings(ruleset.rulings));
    if (!same) {
      throw new ConflictException(
        `Version ${ruleset.version} of "${ruleset.key}" has changed since it was proposed — reload it and propose again.`,
      );
    }
  }

  async describeRulesetProposal(payload: unknown): Promise<string | null> {
    const { rulesetId } = payload as RulesetApprovalPayload;
    const ruleset = await prisma.zakahRuleset.findUnique({ where: { id: rulesetId } });
    if (!ruleset) return `Zakah ruleset "${rulesetId}" not found.`;
    return `Make "${ruleset.label}" version ${ruleset.version} the ${ruleset.madhhab} ruleset the zakah calculator applies (key "${ruleset.key}").`;
  }

  /** The live version this proposal would replace, for the checker's current → proposed diff. */
  async currentRulesetState(payload: unknown): Promise<Record<string, unknown> | null> {
    const { rulesetId } = payload as RulesetApprovalPayload;
    const draft = await prisma.zakahRuleset.findUnique({ where: { id: rulesetId } });
    if (!draft) return null;
    const live = await prisma.zakahRuleset.findFirst({ where: { key: draft.key, status: "approved" } });
    return live ? { label: live.label, rulings: live.rulings, version: live.version } : null;
  }

  /**
   * zakah.ruleset_approve, approval-time, inside decide()'s transaction:
   * the draft goes live and the version it replaces is superseded.
   * Returns the draft's before/after for decide()'s own audit row; the
   * superseded version gets its own audit row here.
   */
  async approveRuleset(
    payload: unknown,
    governedActionId: string,
    checkerUserId: string,
    tx: Prisma.TransactionClient,
  ) {
    const { rulesetId } = payload as RulesetApprovalPayload;
    const before = await tx.zakahRuleset.findUnique({ where: { id: rulesetId } });
    if (!before) throw new NotFoundException(`Zakah ruleset "${rulesetId}" not found.`);
    // One approval per key at a time, so two keys' approvals never wait on each other.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"zakah_rulesets:" + before.key}))`;
    const draft = await tx.zakahRuleset.findUniqueOrThrow({ where: { id: rulesetId } });
    if (draft.status !== "draft") {
      throw new BadRequestException(`Version ${draft.version} of "${draft.key}" is already ${draft.status}.`);
    }
    this.assertSnapshotMatches(draft, payload as RulesetApprovalPayload);

    const live = await tx.zakahRuleset.findFirst({ where: { key: draft.key, status: "approved" } });
    if (live) {
      // Superseded first: the database allows only one approved version per key.
      const superseded = await tx.zakahRuleset.update({ where: { id: live.id }, data: { status: "superseded" } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId: checkerUserId,
          action: "zakah_ruleset.superseded",
          entityType: "ZakahRuleset",
          entityId: live.id,
          before: live as any,
          after: superseded as any,
        },
      });
    }
    const after = await tx.zakahRuleset.update({
      where: { id: draft.id },
      data: { status: "approved", approvedAt: new Date(), approvedGovernedActionId: governedActionId },
    });
    return { before: draft, after };
  }

  // ---- Metal prices ----

  listMetalPrices() {
    return prisma.zakahMetalPrice.findMany({ orderBy: [{ asOf: "desc" }, { createdAt: "desc" }], take: 100 });
  }

  private latestMetalPrice(db: Prisma.TransactionClient | typeof prisma = prisma) {
    // A same-day correction is a second row with the same asOf; the newer one wins.
    return db.zakahMetalPrice.findFirst({ orderBy: [{ asOf: "desc" }, { createdAt: "desc" }] });
  }

  /** What the public calculator uses, with how old it is today. */
  async currentMetalPrices(): Promise<CurrentMetalPrices> {
    const row = await this.latestMetalPrice();
    if (!row) throw new NotFoundException("No metal prices have been approved yet.");
    const prices = toMetalPrices(row);
    return { ...prices, freshness: priceFreshness(prices.asOf, this.today()) };
  }

  /**
   * zakah.metal_price_set, at propose-time and again at approval (a
   * proposal can wait days for a checker). Returns the normalised payload.
   *
   * A price dated before the current one is allowed: it can never become
   * current (the latest asOf wins), so it's only history, and
   * describeMetalPriceProposal tells the checker so.
   */
  validateMetalPriceProposal(payload: unknown): MetalPricePayload {
    const today = this.today();
    const p = (payload ?? {}) as Partial<Record<keyof MetalPricePayload, unknown>>;
    for (const field of ["goldPerGram", "silverPerGram"] as const) {
      const value = p[field];
      if (typeof value !== "string" || !PLAIN_DECIMAL.test(value)) {
        throw new BadRequestException(`payload.${field} must be a Naira amount like "150000" or "150000.50".`);
      }
      const amount = new Prisma.Decimal(value);
      if (amount.lessThanOrEqualTo(0) || amount.greaterThan(MAX_PRICE_PER_GRAM)) {
        throw new BadRequestException(`payload.${field} must be more than ₦0 and at most ₦100,000,000 per gram.`);
      }
    }
    if (typeof p.asOf !== "string" || !ISO_DATE.test(p.asOf) || Number.isNaN(Date.parse(`${p.asOf}T00:00:00Z`))) {
      throw new BadRequestException('payload.asOf must be a date like "2027-02-08".');
    }
    if (p.asOf > today) throw new BadRequestException(`payload.asOf (${p.asOf}) is in the future.`);
    if (priceFreshness(p.asOf, today).status === "expired") {
      throw new BadRequestException(
        `payload.asOf (${p.asOf}) is more than ${PRICES_EXPIRED_AFTER_DAYS} days ago — the calculator couldn't use it.`,
      );
    }
    const source = typeof p.source === "string" ? p.source.trim() : "";
    if (source.length < 1 || source.length > 200) {
      throw new BadRequestException("payload.source must say where the prices came from (up to 200 characters).");
    }
    return { goldPerGram: p.goldPerGram as string, silverPerGram: p.silverPerGram as string, asOf: p.asOf, source };
  }

  async checkDuplicateMetalPriceProposal() {
    const pending = await prisma.governedAction.findFirst({
      where: { status: "proposed", permission: { key: "zakah.metal_price_set" } },
    });
    if (pending) {
      throw new ConflictException("New metal prices are already waiting for approval — check the Approvals queue.");
    }
  }

  /** e.g. "Gold ₦150,000 → ₦165,000/g (+10.0%), silver ₦2,000 → ₦2,100/g (+5.0%), as of 2027-02-08 (source)". */
  async describeMetalPriceProposal(payload: unknown): Promise<string> {
    const { goldPerGram, silverPerGram, asOf, source } = payload as MetalPricePayload;
    const latest = await this.latestMetalPrice();
    const naira = (d: Prisma.Decimal) => `₦${Number(d.toFixed(2)).toLocaleString("en-NG")}`;
    const move = (label: string, from: Prisma.Decimal | undefined, to: string) => {
      const next = new Prisma.Decimal(to);
      if (!from) return `${label} ${naira(next)}/g`;
      const pct = next.minus(from).dividedBy(from).times(100).toFixed(1);
      return `${label} ${naira(from)} → ${naira(next)}/g (${Number(pct) >= 0 ? "+" : ""}${pct}%)`;
    };
    const summary = `${move("Gold", latest?.goldPerGram, goldPerGram)}, ${move("silver", latest?.silverPerGram, silverPerGram)}, as of ${asOf} (${source}).`;
    if (latest && asOf < isoDate(latest.asOf)) {
      return `${summary} Warning: dated before the current prices (${isoDate(latest.asOf)}), so it would be kept as history but never used.`;
    }
    return summary;
  }

  async currentMetalPriceState(): Promise<Record<string, unknown> | null> {
    const latest = await this.latestMetalPrice();
    return latest ? { ...toMetalPrices(latest) } : null;
  }

  /** zakah.metal_price_set, approval-time, inside decide()'s transaction. */
  async recordMetalPrice(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const valid = this.validateMetalPriceProposal(payload);
    return tx.zakahMetalPrice.create({
      data: {
        goldPerGram: valid.goldPerGram,
        silverPerGram: valid.silverPerGram,
        asOf: new Date(`${valid.asOf}T00:00:00Z`),
        source: valid.source,
        governedActionId,
      },
    });
  }
}

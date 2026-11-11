import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsNumberString, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { prisma, Prisma, ZakahFitrCampaign } from "@birr/db";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { lagosToday } from "./zakah.service";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** How long after Eid a finished campaign is still shown (as closed). */
const SHOW_AFTER_EID_DAYS = 30;

export class FitrCampaignFields {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  staple!: string;

  @IsNumberString()
  @IsPositiveDecimal()
  kgPerPerson!: string;

  @IsNumberString()
  @IsPositiveDecimal()
  amountPerPerson!: string;

  @Matches(ISO_DATE, { message: 'opensOn must be a date like "2027-02-08".' })
  opensOn!: string;

  @Matches(ISO_DATE, { message: 'expectedEidOn must be a date like "2027-03-10".' })
  expectedEidOn!: string;
}

export class CreateFitrCampaignInput extends FitrCampaignFields {
  // The Hijri year, e.g. "1448" — one live campaign per season.
  @Matches(/^\d{4}$/, { message: 'season must be the Hijri year, like "1448".' })
  season!: string;
}

/** zakah.fitr_campaign_approve's payload: what the checker is asked to approve, exactly. */
export interface FitrCampaignApprovalPayload extends FitrCampaignFields {
  campaignId: string;
}

export type FitrCampaignState = "upcoming" | "open" | "closed";

type Db = Prisma.TransactionClient | typeof prisma;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayBefore(iso: string): string {
  return isoDate(new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000));
}

function asDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function naira(amount: Prisma.Decimal | string): string {
  return `₦${Number(new Prisma.Decimal(amount).toFixed(2)).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

/** The fields an approval snapshots, in one comparable shape. */
function fieldsOf(c: ZakahFitrCampaign): FitrCampaignFields {
  return {
    staple: c.staple,
    kgPerPerson: c.kgPerPerson.toFixed(),
    amountPerPerson: c.amountPerPerson.toFixed(),
    opensOn: isoDate(c.opensOn),
    expectedEidOn: isoDate(c.expectedEidOn),
  };
}

function sameFields(a: FitrCampaignFields, b: Partial<FitrCampaignFields>): boolean {
  return (
    a.staple === b.staple &&
    typeof b.kgPerPerson === "string" &&
    new Prisma.Decimal(a.kgPerPerson).equals(b.kgPerPerson) &&
    typeof b.amountPerPerson === "string" &&
    new Prisma.Decimal(a.amountPerPerson).equals(b.amountPerPerson) &&
    a.opensOn === b.opensOn &&
    a.expectedEidOn === b.expectedEidOn
  );
}

/**
 * Each Ramadan's Zakah al-Fitr campaign (see ZakahFitrCampaign's schema
 * comment): drafted by a Mutawalli Officer, approved by a Shariah board
 * member, versioned so a moved Eid can be re-approved, and closable early.
 */
@Injectable()
export class ZakahFitrService {
  /** Replaced in tests. */
  now: () => Date = () => new Date();

  private today(): string {
    return lagosToday(this.now());
  }

  private checkFields(input: FitrCampaignFields) {
    const amount = new Prisma.Decimal(input.amountPerPerson);
    if (amount.decimalPlaces() > 2) throw new BadRequestException("amountPerPerson must be in naira and kobo.");
    for (const field of ["opensOn", "expectedEidOn"] as const) {
      if (Number.isNaN(Date.parse(`${input[field]}T00:00:00Z`))) throw new BadRequestException(`${field} isn't a real date.`);
    }
    if (input.opensOn > dayBefore(input.expectedEidOn)) {
      throw new BadRequestException("Payments must open before they close, the day before Eid.");
    }
  }

  private dataOf(input: FitrCampaignFields) {
    return {
      staple: input.staple.trim(),
      kgPerPerson: new Prisma.Decimal(input.kgPerPerson),
      amountPerPerson: new Prisma.Decimal(input.amountPerPerson),
      opensOn: asDate(input.opensOn),
      expectedEidOn: asDate(input.expectedEidOn),
      // Payments close the day before Eid (owner's decision, 2026-11-11).
      closesOn: asDate(dayBefore(input.expectedEidOn)),
    };
  }

  list() {
    return prisma.zakahFitrCampaign.findMany({ orderBy: [{ season: "desc" }, { version: "desc" }] });
  }

  async createDraft(input: CreateFitrCampaignInput, actorUserId: string) {
    this.checkFields(input);
    return prisma.$transaction(async (tx) => {
      const latest = await tx.zakahFitrCampaign.findFirst({ where: { season: input.season }, orderBy: { version: "desc" } });
      if (latest?.status === "draft") {
        throw new ConflictException(`Ramadan ${input.season} already has a draft — edit that one instead.`);
      }
      const created = await tx.zakahFitrCampaign.create({
        data: { season: input.season, version: (latest?.version ?? 0) + 1, ...this.dataOf(input), createdByUserId: actorUserId },
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "zakah_fitr_campaign.drafted", entityType: "ZakahFitrCampaign", entityId: created.id, after: created as any },
      });
      return created;
    });
  }

  async updateDraft(id: string, input: FitrCampaignFields, actorUserId: string) {
    this.checkFields(input);
    return prisma.$transaction(async (tx) => {
      const before = await tx.zakahFitrCampaign.findUnique({ where: { id } });
      if (!before) throw new NotFoundException(`Fitr campaign "${id}" not found.`);
      if (before.status !== "draft") throw new BadRequestException("Only a draft can be edited — draft a new version instead.");
      if (await this.pendingApproval(id, tx)) {
        throw new ConflictException("This draft is waiting for Shariah approval. Ask the board to reject that proposal before editing it.");
      }
      const updated = await tx.zakahFitrCampaign.update({ where: { id }, data: this.dataOf(input) });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff", actorUserId, action: "zakah_fitr_campaign.draft_updated", entityType: "ZakahFitrCampaign",
          entityId: id, before: before as any, after: updated as any,
        },
      });
      return updated;
    });
  }

  private pendingApproval(campaignId: string, db: Db = prisma) {
    return db.governedAction.findFirst({
      where: { status: "proposed", permission: { key: "zakah.fitr_campaign_approve" }, payload: { path: ["campaignId"], equals: campaignId } },
    });
  }

  /** Whether fitr payments are taken today under this approved campaign. */
  stateOf(c: ZakahFitrCampaign): FitrCampaignState {
    const today = this.today();
    if (today < isoDate(c.opensOn)) return "upcoming";
    if (c.closedAt || today > isoDate(c.closesOn)) return "closed";
    return "open";
  }

  /**
   * The campaign that matters today: the soonest approved one that hasn't
   * reached its closing date, or, for a month after Eid, the one just
   * finished (shown as closed). After that there's no current campaign
   * until next season's is approved. What the public page shows and
   * payments use.
   */
  async current(db: Db = prisma) {
    const todayIso = this.today();
    const today = asDate(todayIso);
    const recentEid = asDate(isoDate(new Date(today.getTime() - SHOW_AFTER_EID_DAYS * 86_400_000)));
    const campaign =
      (await db.zakahFitrCampaign.findFirst({
        where: { status: "approved", closesOn: { gte: today } },
        orderBy: [{ closesOn: "asc" }, { approvedAt: "desc" }],
      })) ??
      (await db.zakahFitrCampaign.findFirst({
        where: { status: "approved", expectedEidOn: { gte: recentEid } },
        orderBy: [{ closesOn: "desc" }, { approvedAt: "desc" }],
      }));
    if (!campaign) return null;
    return { campaign, state: this.stateOf(campaign) };
  }

  /** Public shape: what a payer needs, nothing about who approved it. */
  async currentPublic() {
    const current = await this.current();
    if (!current) throw new NotFoundException("No Zakah al-Fitr campaign has been approved yet.");
    const { campaign: c, state } = current;
    return {
      id: c.id,
      season: c.season,
      staple: c.staple,
      kgPerPerson: c.kgPerPerson.toFixed(),
      amountPerPerson: c.amountPerPerson.toFixed(2),
      opensOn: isoDate(c.opensOn),
      closesOn: isoDate(c.closesOn),
      expectedEidOn: isoDate(c.expectedEidOn),
      state,
    };
  }

  /** Stop taking payments now — e.g. once Eid is announced. Only ever stops money coming in. */
  async close(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.zakahFitrCampaign.findUnique({ where: { id } });
      if (!before) throw new NotFoundException(`Fitr campaign "${id}" not found.`);
      if (before.status !== "approved") throw new BadRequestException("Only the live campaign can be closed.");
      if (before.closedAt) throw new ConflictException("Payments for this campaign are already closed.");
      const updated = await tx.zakahFitrCampaign.update({ where: { id }, data: { closedAt: new Date() } });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "zakah_fitr_campaign.closed", entityType: "ZakahFitrCampaign", entityId: id, before: before as any, after: updated as any },
      });
      return updated;
    });
  }

  // ---- zakah.fitr_campaign_approve ----

  private async findOrThrow(id: unknown, db: Db = prisma) {
    if (typeof id !== "string") throw new BadRequestException("payload.campaignId is required.");
    const c = await db.zakahFitrCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException(`Fitr campaign "${id}" not found.`);
    return c;
  }

  private assertSnapshot(c: ZakahFitrCampaign, payload: Partial<FitrCampaignApprovalPayload>) {
    if (!sameFields(fieldsOf(c), payload)) {
      throw new ConflictException(`Ramadan ${c.season} version ${c.version} has changed since it was proposed — reload it and propose again.`);
    }
  }

  async validateApprovalProposal(payload: unknown) {
    const p = (payload ?? {}) as Partial<FitrCampaignApprovalPayload>;
    const c = await this.findOrThrow(p.campaignId);
    if (c.status !== "draft") throw new BadRequestException(`This campaign version is already ${c.status}.`);
    this.assertSnapshot(c, p);
  }

  async checkDuplicateApproval(payload: unknown) {
    if (await this.pendingApproval((payload as FitrCampaignApprovalPayload).campaignId)) {
      throw new ConflictException("This campaign is already waiting for Shariah approval — check the Approvals queue.");
    }
  }

  async describe(payload: unknown): Promise<string> {
    const c = await this.findOrThrow((payload as FitrCampaignApprovalPayload).campaignId);
    return (
      `Zakah al-Fitr for Ramadan ${c.season}: ${c.kgPerPerson.toFixed()}kg of ${c.staple} per person, valued at ${naira(c.amountPerPerson)} ` +
      `(paid as food, or as cash by Hanafi payers). Payments ${isoDate(c.opensOn)} to ${isoDate(c.closesOn)}; Eid expected ${isoDate(c.expectedEidOn)}.`
    );
  }

  /** The live version this would replace, for the checker's current → proposed diff. */
  async currentState(payload: unknown): Promise<Record<string, unknown> | null> {
    const draft = await this.findOrThrow((payload as FitrCampaignApprovalPayload).campaignId);
    const live = await prisma.zakahFitrCampaign.findFirst({ where: { season: draft.season, status: "approved" } });
    return live ? { version: live.version, ...fieldsOf(live) } : null;
  }

  async approve(payload: unknown, governedActionId: string, checkerUserId: string, tx: Prisma.TransactionClient) {
    const p = payload as FitrCampaignApprovalPayload;
    const first = await this.findOrThrow(p.campaignId, tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"zakah_fitr_campaigns:" + first.season}))`;
    const draft = await this.findOrThrow(p.campaignId, tx);
    if (draft.status !== "draft") throw new BadRequestException(`This campaign version is already ${draft.status}.`);
    this.assertSnapshot(draft, p);
    const live = await tx.zakahFitrCampaign.findFirst({ where: { season: draft.season, status: "approved" } });
    if (live) {
      const superseded = await tx.zakahFitrCampaign.update({ where: { id: live.id }, data: { status: "superseded" } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff", actorUserId: checkerUserId, action: "zakah_fitr_campaign.superseded", entityType: "ZakahFitrCampaign",
          entityId: live.id, before: live as any, after: superseded as any,
        },
      });
    }
    const after = await tx.zakahFitrCampaign.update({
      where: { id: draft.id },
      data: { status: "approved", approvedAt: new Date(), approvedGovernedActionId: governedActionId },
    });
    return { before: draft, after };
  }
}

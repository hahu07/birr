import { createHash } from "crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumberString, Max, Min, ValidateNested } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { LongTextField, NameField, TextField } from "../../common/validation/fields";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { assertProduct } from "../waqf-programmes/programme-products";

const CODE = /^[A-Z0-9][A-Z0-9-]{0,29}$/;

export class PriceListServiceInput {
  // A short code the operator's claims use, e.g. "ANC-TESTS".
  @TextField(30)
  code!: string;

  @NameField()
  name!: string;

  @IsNumberString()
  @IsPositiveDecimal()
  price!: string;
}

export class PriceListBandInput {
  @TextField(30)
  code!: string;

  @NameField()
  name!: string;

  // Who falls in this band, e.g. "Household income under ₦50,000 a month".
  @LongTextField(500)
  whoQualifies!: string;

  // The share of each visit's price the patient pays.
  @IsInt()
  @Min(0)
  @Max(100)
  patientSharePercent!: number;
}

export class DraftClinicPriceListInput {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PriceListServiceInput)
  services!: PriceListServiceInput[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PriceListBandInput)
  bands!: PriceListBandInput[];

  // The most the running fund pays in subsidies a month.
  @IsNumberString()
  @IsPositiveDecimal()
  monthlySubsidyCap!: string;
}

export interface PriceListContent {
  services: { code: string; name: string; price: string }[];
  bands: { code: string; name: string; whoQualifies: string; patientSharePercent: number }[];
  monthlySubsidyCap: string;
}

const money = (raw: string, what: string) => {
  const d = new Prisma.Decimal(raw);
  if (d.lte(0) || d.decimalPlaces() > 2) throw new BadRequestException(`${what} must be a positive amount in naira and kobo.`);
  return d.toFixed(2);
};

/**
 * The one canonical form a version is stored and hashed in: fixed key
 * order, codes upper-cased, money to two places, services and bands sorted
 * by code. The same list always gives the same text, so its hash names it.
 */
export function canonicalPriceList(input: DraftClinicPriceListInput): { content: PriceListContent; text: string } {
  const unique = (codes: string[], what: string) => {
    const seen = new Set<string>();
    for (const c of codes) {
      if (!CODE.test(c)) throw new BadRequestException(`${what} code "${c}" must be capital letters, digits and hyphens.`);
      if (seen.has(c)) throw new BadRequestException(`${what} code "${c}" is used twice.`);
      seen.add(c);
    }
  };
  const services = input.services
    .map((s) => ({ code: s.code.trim().toUpperCase(), name: s.name.trim(), price: money(s.price, `The price of ${s.name}`) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const bands = input.bands
    .map((b) => ({ code: b.code.trim().toUpperCase(), name: b.name.trim(), whoQualifies: b.whoQualifies.trim(), patientSharePercent: b.patientSharePercent }))
    .sort((a, b) => a.code.localeCompare(b.code));
  unique(services.map((s) => s.code), "Service");
  unique(bands.map((b) => b.code), "Band");
  const content: PriceListContent = { services, bands, monthlySubsidyCap: money(input.monthlySubsidyCap, "The monthly subsidy cap") };
  return { content, text: JSON.stringify(content) };
}

export const priceListHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

interface ApprovalPayload {
  priceListId: string;
  contentHash: string;
}

const userName = { select: { id: true, fullName: true } };

/**
 * A clinic waqf's price list and subsidy bands (2026-11-17, clinic slice
 * 6), versioned like its deed. A Mutawalli Officer drafts a version
 * (waqf_programme.manage); the Board of Trustees or Compliance approves it
 * (clinic.price_list_approve), naming its content's hash; approving
 * supersedes the previous version. Monthly claims (slice 7) are checked
 * against the approved version.
 */
@Injectable()
export class ClinicPriceListsService {
  async draft(programmeId: string, input: DraftClinicPriceListInput, actorUserId: string) {
    const { text } = canonicalPriceList(input);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${programmeId} FOR UPDATE`;
      const clinic = await tx.waqfProgramme.findUnique({ where: { id: programmeId } });
      if (!clinic) throw new NotFoundException(`Clinic waqf "${programmeId}" not found.`);
      assertProduct(clinic, "clinic", "Price lists");
      const open = await tx.clinicPriceList.findFirst({ where: { programmeId, status: "draft" } });
      if (open) throw new ConflictException(`Version ${open.version} is still a draft. Discard it, or have it approved, before drafting another.`);
      const latest = await tx.clinicPriceList.aggregate({ where: { programmeId }, _max: { version: true } });
      const list = await tx.clinicPriceList.create({
        data: { programmeId, version: (latest._max.version ?? 0) + 1, content: text, contentHash: priceListHash(text), createdByUserId: actorUserId },
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_price_list.drafted", entityType: "ClinicPriceList", entityId: list.id, after: list as any },
      });
      return list;
    });
  }

  async discard(programmeId: string, priceListId: string, actorUserId: string) {
    if (await this.pending(priceListId)) throw new ConflictException("This draft is waiting for approval. Have the proposal rejected first.");
    return prisma.$transaction(async (tx) => {
      const before = await tx.clinicPriceList.findUnique({ where: { id: priceListId } });
      if (!before || before.programmeId !== programmeId) throw new NotFoundException(`Price list "${priceListId}" not found.`);
      if (before.status !== "draft") throw new BadRequestException(`Version ${before.version} is ${before.status}, not a draft.`);
      const after = await tx.clinicPriceList.update({ where: { id: priceListId }, data: { status: "discarded" } });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_price_list.discarded", entityType: "ClinicPriceList", entityId: priceListId, before: before as any, after: after as any },
      });
      return after;
    });
  }

  async list(programmeId: string) {
    const lists = await prisma.clinicPriceList.findMany({
      where: { programmeId },
      orderBy: { version: "desc" },
      include: { createdByUser: userName },
    });
    return lists.map(({ content, ...l }) => ({ ...l, content: JSON.parse(content) as PriceListContent }));
  }

  /** The approved version, parsed: what claims are checked against. Null before one is approved. */
  async current(db: Prisma.TransactionClient | typeof prisma, programmeId: string) {
    const list = await db.clinicPriceList.findFirst({ where: { programmeId, status: "approved" } });
    return list ? { id: list.id, version: list.version, content: JSON.parse(list.content) as PriceListContent } : null;
  }

  // ---- clinic.price_list_approve (checkers: Board, Compliance) ----

  private parse(payload: unknown): ApprovalPayload {
    const p = (payload ?? {}) as Partial<Record<keyof ApprovalPayload, unknown>>;
    if (typeof p.priceListId !== "string") throw new BadRequestException("payload.priceListId is required.");
    if (typeof p.contentHash !== "string") throw new BadRequestException("payload.contentHash is required: the hash of the list being approved.");
    return { priceListId: p.priceListId, contentHash: p.contentHash };
  }

  async validateProposal(payload: unknown) {
    const { priceListId, contentHash } = this.parse(payload);
    const list = await prisma.clinicPriceList.findUnique({ where: { id: priceListId } });
    if (!list) throw new NotFoundException(`Price list "${priceListId}" not found.`);
    if (list.status !== "draft") throw new BadRequestException(`Version ${list.version} is ${list.status}, not a draft.`);
    if (list.contentHash !== contentHash) throw new BadRequestException("The list has changed since it was shown. Reload it and propose again.");
  }

  async checkDuplicate(payload: unknown) {
    if (await this.pending(this.parse(payload).priceListId)) {
      throw new ConflictException("This price list is already waiting for approval — check the Approvals queue.");
    }
  }

  async describe(payload: unknown): Promise<string> {
    const list = await prisma.clinicPriceList.findUnique({ where: { id: this.parse(payload).priceListId }, include: { programme: { select: { name: true } } } });
    if (!list) return "Price list not found.";
    const content = JSON.parse(list.content) as PriceListContent;
    return `Version ${list.version} of ${list.programme.name}'s price list: ${content.services.length} services, ${content.bands.length} subsidy bands, monthly subsidy cap ₦${Number(content.monthlySubsidyCap).toLocaleString("en-NG")}`;
  }

  /** What the approver reads: the whole list, and the version it replaces. */
  async currentState(payload: unknown): Promise<Record<string, unknown>> {
    const list = await prisma.clinicPriceList.findUniqueOrThrow({ where: { id: this.parse(payload).priceListId } });
    const approved = await prisma.clinicPriceList.findFirst({ where: { programmeId: list.programmeId, status: "approved" } });
    return { status: list.status, version: list.version, content: JSON.parse(list.content), replacesApprovedVersion: approved?.version ?? null };
  }

  async approve(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const { priceListId, contentHash } = this.parse(payload);
    const found = await tx.clinicPriceList.findUnique({ where: { id: priceListId } });
    if (!found) throw new NotFoundException(`Price list "${priceListId}" not found.`);
    await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${found.programmeId} FOR UPDATE`;
    const draft = await tx.clinicPriceList.findUniqueOrThrow({ where: { id: priceListId } });
    if (draft.status !== "draft") throw new BadRequestException(`Version ${draft.version} is already ${draft.status}.`);
    if (draft.contentHash !== contentHash) throw new BadRequestException("The list isn't the list that was proposed.");
    const live = await tx.clinicPriceList.findFirst({ where: { programmeId: draft.programmeId, status: "approved" } });
    if (live) await tx.clinicPriceList.update({ where: { id: live.id }, data: { status: "superseded" } });
    const after = await tx.clinicPriceList.update({ where: { id: priceListId }, data: { status: "approved", approvedAt: new Date(), approvedActionId: governedActionId } });
    return { before: draft, after };
  }

  private pending(priceListId: string) {
    return prisma.governedAction.findFirst({
      where: { status: "proposed", permission: { key: "clinic.price_list_approve" }, payload: { path: ["priceListId"], equals: priceListId } },
    });
  }
}

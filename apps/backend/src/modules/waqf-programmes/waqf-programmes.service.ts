import { IdField, LongTextField, NameField, TextField } from "../../common/validation/fields";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsIn, IsNumberString, IsOptional, Matches } from "class-validator";
import { prisma, Prisma, type WaqfProgrammeProduct } from "@birr/db";
import { CountryCode } from "../../common/validation/country-code";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { deedTextHash } from "../clinics/clinic-waqf-deed";
import { PRODUCTS, productOf, standardDeedText } from "./programme-products";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DEED_TEXT_LIMIT = 20_000;

export class CreateWaqfProgrammeInput {
  // Which product (WAQF_PROGRAMME_PRODUCTS); fixed once created.
  @IsIn(Object.keys(PRODUCTS))
  product!: WaqfProgrammeProduct;

  @NameField()
  name!: string;

  @TextField(100)
  @Matches(SLUG, { message: "slug must be lowercase letters, numbers and single hyphens, e.g. mother-and-child-clinic-ibadan." })
  slug!: string;

  @NameField()
  city!: string;

  @CountryCode()
  jurisdiction!: string;

  @IsOptional()
  @LongTextField()
  description?: string;
}

export class UpdateWaqfProgrammeInput {
  @IsOptional()
  @NameField()
  name?: string;

  @IsOptional()
  @NameField()
  city?: string;

  @IsOptional()
  @LongTextField()
  description?: string;

  // Public fundraising targets (slice 8), in naira.
  @IsOptional()
  @IsNumberString()
  @IsPositiveDecimal()
  endowmentTarget?: string;

  @IsOptional()
  @IsNumberString()
  @IsPositiveDecimal()
  runningMonthlyTarget?: string;

  // The causes it serves, from the cause catalog; replaces the current set.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IdField({ each: true })
  causeCategoryIds?: string[];
}

// GET /waqf-programmes filters (step 4): all optional, combined.
export class ListWaqfProgrammesQuery {
  @IsOptional()
  @IsIn(Object.keys(PRODUCTS))
  product?: WaqfProgrammeProduct;

  @IsOptional()
  @IdField()
  causeCategoryId?: string;

  @IsOptional()
  @IsIn(["draft", "established"])
  status?: "draft" | "established";
}

export class DraftProgrammeDeedInput {
  // Omitted: the product's standard wording (programme-products.ts), filled in for this programme.
  @IsOptional()
  @LongTextField(DEED_TEXT_LIMIT)
  text?: string;
}

interface DeedApprovalPayload {
  deedId: string;
  textHash: string;
}

interface SubaccountPayload {
  programmeId: string;
  subaccountCode: string;
}

/** A Paystack subaccount code: ACCT_ and letters or digits (the database checks the same). */
const SUBACCOUNT_CODE = /^ACCT_[A-Za-z0-9]+$/;

interface EstablishPayload {
  programmeId: string;
}

const userName = { select: { id: true, fullName: true } };

/**
 * The clinic waqf (2026-11-17, clinic slice 2): a waqf Birr itself
 * establishes for the Mother & Child Clinic, with a versioned deed and a
 * ledger that keeps the endowment and the running fund apart. A Mutawalli
 * Officer creates it and drafts its deed (waqf_programme.manage); a Shariah
 * board member approves each deed version (waqf_programme.deed_approve); the
 * Board of Trustees approves establishing it (waqf_programme.establish). The
 * governed-action engine calls the approval methods below.
 */
@Injectable()
export class WaqfProgrammesService {
  async create(input: CreateWaqfProgrammeInput, actorUserId: string) {
    if (await prisma.waqfProgramme.findUnique({ where: { slug: input.slug } })) {
      throw new ConflictException(`The address "${input.slug}" is already used by another clinic waqf.`);
    }
    return prisma.$transaction(async (tx) => {
      const clinic = await tx.waqfProgramme.create({ data: { ...input, createdByUserId: actorUserId } });
      // Tagged with the product's default causes, where the catalog has them.
      const defaults = await tx.causeCategory.findMany({ where: { name: { in: [...productOf(clinic).defaultCauses] }, deletedAt: null }, select: { id: true } });
      if (defaults.length > 0) {
        await tx.waqfProgrammeCause.createMany({ data: defaults.map((c) => ({ programmeId: clinic.id, causeCategoryId: c.id })) });
      }
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_programme.created",
          entityType: "WaqfProgramme",
          entityId: clinic.id,
          after: { ...clinic, causeCategoryIds: defaults.map((c) => c.id) } as any,
        },
      });
      return clinic;
    });
  }

  /** Name, city and description; the address and jurisdiction stay as set. */
  async update(id: string, input: UpdateWaqfProgrammeInput, actorUserId: string) {
    for (const target of [input.endowmentTarget, input.runningMonthlyTarget]) {
      if (target && new Prisma.Decimal(target).decimalPlaces() > 2) throw new BadRequestException("Enter targets in naira and kobo.");
    }
    const { causeCategoryIds, ...fields } = input;
    if (causeCategoryIds) {
      const unique = [...new Set(causeCategoryIds)];
      const found = await prisma.causeCategory.count({ where: { id: { in: unique }, deletedAt: null } });
      if (found !== unique.length) throw new BadRequestException("Every cause must be a current entry in the cause catalog.");
    }
    return prisma.$transaction(async (tx) => {
      const found = await tx.waqfProgramme.findUnique({ where: { id }, include: { causes: { select: { causeCategoryId: true } } } });
      if (!found) throw new NotFoundException(`Waqf programme "${id}" not found.`);
      const { causes: beforeCauses, ...beforeRow } = found;
      const updated = await tx.waqfProgramme.update({ where: { id }, data: fields });
      let causeIds = beforeCauses.map((c) => c.causeCategoryId);
      if (causeCategoryIds) {
        const wanted = [...new Set(causeCategoryIds)];
        await tx.waqfProgrammeCause.deleteMany({ where: { programmeId: id, causeCategoryId: { notIn: wanted } } });
        await tx.waqfProgrammeCause.createMany({ data: wanted.map((causeCategoryId) => ({ programmeId: id, causeCategoryId })), skipDuplicates: true });
        causeIds = wanted;
      }
      const before = { ...beforeRow, causeCategoryIds: beforeCauses.map((c) => c.causeCategoryId) };
      const after = { ...updated, causeCategoryIds: causeIds };
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_programme.updated",
          entityType: "WaqfProgramme",
          entityId: id,
          before: before as any,
          after: after as any,
        },
      });
      return after;
    });
  }

  list(filter: ListWaqfProgrammesQuery = {}) {
    return prisma.waqfProgramme.findMany({
      where: {
        ...(filter.product && { product: filter.product }),
        ...(filter.status && { status: filter.status }),
        ...(filter.causeCategoryId && { causes: { some: { causeCategoryId: filter.causeCategoryId } } }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        deeds: { where: { status: "approved" }, select: { version: true } },
        causes: { select: { causeCategory: { select: { id: true, name: true } } } },
      },
    });
  }

  async findById(id: string) {
    const clinic = await prisma.waqfProgramme.findUnique({
      where: { id },
      include: {
        createdByUser: userName,
        causes: { select: { causeCategory: { select: { id: true, name: true } } } },
        deeds: { orderBy: { version: "desc" }, include: { createdByUser: userName } },
        operator: { select: { id: true, name: true, status: true } },
      },
    });
    if (!clinic) throw new NotFoundException(`Clinic waqf "${id}" not found.`);
    return clinic;
  }

  /** The standard wording, filled in for this clinic, to start a draft from. */
  async deedTemplate(id: string) {
    const clinic = await prisma.waqfProgramme.findUnique({ where: { id } });
    if (!clinic) throw new NotFoundException(`Clinic waqf "${id}" not found.`);
    return { text: standardDeedText(clinic) };
  }

  /** A new version, as a draft. One open draft at a time; its text never changes once drafted. */
  async draftDeed(programmeId: string, input: DraftProgrammeDeedInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${programmeId} FOR UPDATE`;
      const clinic = await tx.waqfProgramme.findUnique({ where: { id: programmeId } });
      if (!clinic) throw new NotFoundException(`Clinic waqf "${programmeId}" not found.`);
      const openDraft = await tx.waqfProgrammeDeed.findFirst({ where: { programmeId, status: "draft" } });
      if (openDraft) {
        throw new ConflictException(`Version ${openDraft.version} is still a draft. Discard it, or have it approved, before drafting another.`);
      }
      const latest = await tx.waqfProgrammeDeed.aggregate({ where: { programmeId }, _max: { version: true } });
      const text = (input.text ?? standardDeedText(clinic)).replace(/\r\n/g, "\n");
      const deed = await tx.waqfProgrammeDeed.create({
        data: {
          programmeId,
          version: (latest._max.version ?? 0) + 1,
          text,
          textHash: deedTextHash(text),
          createdByUserId: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_programme_deed.drafted",
          entityType: "WaqfProgrammeDeed",
          entityId: deed.id,
          after: deed as any,
        },
      });
      return deed;
    });
  }

  /** Drops a draft that won't be approved. Refused while its approval is waiting. */
  async discardDeed(programmeId: string, deedId: string, actorUserId: string) {
    if (await this.pendingAction("waqf_programme.deed_approve", "deedId", deedId)) {
      throw new ConflictException("This draft is waiting for Shariah approval. Have the proposal rejected first.");
    }
    return prisma.$transaction(async (tx) => {
      const before = await tx.waqfProgrammeDeed.findUnique({ where: { id: deedId } });
      if (!before || before.programmeId !== programmeId) throw new NotFoundException(`Deed version "${deedId}" not found.`);
      if (before.status !== "draft") throw new BadRequestException(`Version ${before.version} is ${before.status}, not a draft.`);
      const after = await tx.waqfProgrammeDeed.update({ where: { id: deedId }, data: { status: "discarded" } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_programme_deed.discarded",
          entityType: "WaqfProgrammeDeed",
          entityId: deedId,
          before: before as any,
          after: after as any,
        },
      });
      return after;
    });
  }

  // ---- waqf_programme.deed_approve (checker: shariah_board_member only) ----

  private parseDeedPayload(payload: unknown): DeedApprovalPayload {
    const p = (payload ?? {}) as Partial<Record<keyof DeedApprovalPayload, unknown>>;
    if (typeof p.deedId !== "string") throw new BadRequestException("payload.deedId is required.");
    if (typeof p.textHash !== "string") throw new BadRequestException("payload.textHash is required: the hash of the wording being approved.");
    return { deedId: p.deedId, textHash: p.textHash };
  }

  async validateDeedProposal(payload: unknown) {
    const { deedId, textHash } = this.parseDeedPayload(payload);
    const deed = await prisma.waqfProgrammeDeed.findUnique({ where: { id: deedId } });
    if (!deed) throw new NotFoundException(`Deed version "${deedId}" not found.`);
    if (deed.status !== "draft") throw new BadRequestException(`Version ${deed.version} is ${deed.status}, not a draft.`);
    if (deed.textHash !== textHash) throw new BadRequestException("The wording has changed since it was shown. Reload it and propose again.");
  }

  async checkDuplicateDeedProposal(payload: unknown) {
    if (await this.pendingAction("waqf_programme.deed_approve", "deedId", this.parseDeedPayload(payload).deedId)) {
      throw new ConflictException("This deed version is already waiting for Shariah approval — check the Approvals queue.");
    }
  }

  async describeDeedProposal(payload: unknown): Promise<string> {
    const deed = await prisma.waqfProgrammeDeed.findUnique({
      where: { id: this.parseDeedPayload(payload).deedId },
      include: { programme: { select: { name: true } } },
    });
    return deed ? `Version ${deed.version} of the deed of ${deed.programme.name}` : "Deed version not found.";
  }

  /** What the Shariah approver reads: the full wording, and the version it would replace. */
  async currentDeedState(payload: unknown): Promise<Record<string, unknown>> {
    const deed = await prisma.waqfProgrammeDeed.findUniqueOrThrow({ where: { id: this.parseDeedPayload(payload).deedId } });
    const approved = await prisma.waqfProgrammeDeed.findFirst({ where: { programmeId: deed.programmeId, status: "approved" } });
    return {
      status: deed.status,
      version: deed.version,
      text: deed.text,
      replacesApprovedVersion: approved?.version ?? null,
    };
  }

  async approveDeed(payload: unknown, governedActionId: string, checkerUserId: string, tx: Prisma.TransactionClient) {
    const { deedId, textHash } = this.parseDeedPayload(payload);
    const found = await tx.waqfProgrammeDeed.findUnique({ where: { id: deedId } });
    if (!found) throw new NotFoundException(`Deed version "${deedId}" not found.`);
    // The clinic's row orders approvals of its deed; every lock comes before any audit row.
    await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${found.programmeId} FOR UPDATE`;
    const draft = await tx.waqfProgrammeDeed.findUniqueOrThrow({ where: { id: deedId } });
    if (draft.status !== "draft") throw new BadRequestException(`Version ${draft.version} is already ${draft.status}.`);
    if (draft.textHash !== textHash) throw new BadRequestException("The wording isn't the wording that was proposed.");

    const live = await tx.waqfProgrammeDeed.findFirst({ where: { programmeId: draft.programmeId, status: "approved" } });
    // Superseded first: the database allows one approved version per clinic.
    const superseded = live ? await tx.waqfProgrammeDeed.update({ where: { id: live.id }, data: { status: "superseded" } }) : null;
    const after = await tx.waqfProgrammeDeed.update({
      where: { id: deedId },
      data: { status: "approved", approvedAt: new Date(), approvedActionId: governedActionId },
    });
    if (live && superseded) {
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId: checkerUserId,
          action: "waqf_programme_deed.superseded",
          entityType: "WaqfProgrammeDeed",
          entityId: live.id,
          before: live as any,
          after: superseded as any,
        },
      });
    }
    return { before: draft, after };
  }

  // ---- waqf_programme.establish (checker: board_of_trustees only) ----

  private parseEstablishPayload(payload: unknown): EstablishPayload {
    const p = (payload ?? {}) as Partial<Record<keyof EstablishPayload, unknown>>;
    if (typeof p.programmeId !== "string") throw new BadRequestException("payload.programmeId is required.");
    return { programmeId: p.programmeId };
  }

  private async assertEstablishable(db: Prisma.TransactionClient | typeof prisma, programmeId: string) {
    const clinic = await db.waqfProgramme.findUnique({ where: { id: programmeId } });
    if (!clinic) throw new NotFoundException(`Clinic waqf "${programmeId}" not found.`);
    if (clinic.status !== "draft") throw new BadRequestException(`${clinic.name} is already established.`);
    const approved = await db.waqfProgrammeDeed.findFirst({ where: { programmeId, status: "approved" } });
    if (!approved) throw new BadRequestException(`${clinic.name} has no approved deed yet. A Shariah board member must approve one first.`);
    return { clinic, approved };
  }

  async validateEstablishProposal(payload: unknown) {
    await this.assertEstablishable(prisma, this.parseEstablishPayload(payload).programmeId);
  }

  async checkDuplicateEstablishProposal(payload: unknown) {
    if (await this.pendingAction("waqf_programme.establish", "programmeId", this.parseEstablishPayload(payload).programmeId)) {
      throw new ConflictException("Establishing this clinic waqf is already waiting for the Board — check the Approvals queue.");
    }
  }

  async describeEstablishProposal(payload: unknown): Promise<string> {
    const clinic = await prisma.waqfProgramme.findUnique({ where: { id: this.parseEstablishPayload(payload).programmeId } });
    return clinic ? `Establish ${clinic.name} (${clinic.city})` : "Clinic waqf not found.";
  }

  async currentEstablishState(payload: unknown): Promise<Record<string, unknown>> {
    const { programmeId } = this.parseEstablishPayload(payload);
    const clinic = await prisma.waqfProgramme.findUniqueOrThrow({ where: { id: programmeId } });
    const approved = await prisma.waqfProgrammeDeed.findFirst({ where: { programmeId, status: "approved" } });
    return { status: clinic.status, city: clinic.city, jurisdiction: clinic.jurisdiction, approvedDeedVersion: approved?.version ?? null };
  }

  async establish(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const { programmeId } = this.parseEstablishPayload(payload);
    await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${programmeId} FOR UPDATE`;
    const { clinic: before } = await this.assertEstablishable(tx, programmeId);
    const after = await tx.waqfProgramme.update({
      where: { id: programmeId },
      data: { status: "established", establishedAt: new Date(), establishedActionId: governedActionId },
    });
    return { before, after };
  }

  // ---- waqf_programme.subaccount_set (maker: platform_admin; checker: Board or Compliance) ----
  //
  // Owner's decision (2026-11-18): two people decide where a waqf
  // programme's money settles. Its gifts settle into this subaccount, its
  // own bank account; none is taken until it's set.

  private parseSubaccountPayload(payload: unknown): SubaccountPayload {
    const p = (payload ?? {}) as Partial<Record<keyof SubaccountPayload, unknown>>;
    if (typeof p.programmeId !== "string") throw new BadRequestException("payload.programmeId is required.");
    const code = typeof p.subaccountCode === "string" ? p.subaccountCode.trim() : "";
    if (!SUBACCOUNT_CODE.test(code)) {
      throw new BadRequestException("payload.subaccountCode must be a Paystack subaccount code, like ACCT_8f4s1eq7ml6rlzj.");
    }
    return { programmeId: p.programmeId, subaccountCode: code };
  }

  private async checkSubaccount(db: Prisma.TransactionClient | typeof prisma, payload: unknown) {
    const { programmeId, subaccountCode } = this.parseSubaccountPayload(payload);
    const programme = await db.waqfProgramme.findUnique({ where: { id: programmeId } });
    if (!programme) throw new NotFoundException(`Waqf programme "${programmeId}" not found.`);
    if (programme.paystackSubaccountCode === subaccountCode) throw new BadRequestException(`${programme.name} already settles into ${subaccountCode}.`);
    const other = await db.waqfProgramme.findFirst({ where: { paystackSubaccountCode: subaccountCode, id: { not: programmeId } } });
    if (other) throw new BadRequestException(`${subaccountCode} is ${other.name}'s subaccount. Each waqf programme settles into its own account.`);
    return { programme, subaccountCode };
  }

  async validateSubaccountProposal(payload: unknown) {
    await this.checkSubaccount(prisma, payload);
  }

  async checkDuplicateSubaccountProposal(payload: unknown) {
    if (await this.pendingAction("waqf_programme.subaccount_set", "programmeId", this.parseSubaccountPayload(payload).programmeId)) {
      throw new ConflictException("A change to this programme's subaccount is already waiting for approval — check the Approvals queue.");
    }
  }

  async describeSubaccountProposal(payload: unknown): Promise<string> {
    const { programmeId, subaccountCode } = this.parseSubaccountPayload(payload);
    const programme = await prisma.waqfProgramme.findUnique({ where: { id: programmeId } });
    if (!programme) return "Waqf programme not found.";
    return programme.paystackSubaccountCode
      ? `Change where ${programme.name}'s gifts settle, from Paystack subaccount ${programme.paystackSubaccountCode} to ${subaccountCode}`
      : `Settle ${programme.name}'s gifts into Paystack subaccount ${subaccountCode}, its own bank account`;
  }

  async currentSubaccountState(payload: unknown): Promise<Record<string, unknown>> {
    const { programmeId } = this.parseSubaccountPayload(payload);
    const programme = await prisma.waqfProgramme.findUniqueOrThrow({ where: { id: programmeId } });
    return { subaccountCode: programme.paystackSubaccountCode, setAt: programme.paystackSubaccountSetAt };
  }

  async setSubaccount(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const { programmeId } = this.parseSubaccountPayload(payload);
    await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${programmeId} FOR UPDATE`;
    const { programme: before, subaccountCode } = await this.checkSubaccount(tx, payload);
    const after = await tx.waqfProgramme.update({
      where: { id: programmeId },
      data: { paystackSubaccountCode: subaccountCode, paystackSubaccountSetAt: new Date(), paystackSubaccountActionId: governedActionId },
    });
    return { before, after };
  }

  private pendingAction(permissionKey: string, field: string, value: string) {
    return prisma.governedAction.findFirst({
      where: { status: "proposed", permission: { key: permissionKey }, payload: { path: [field], equals: value } },
    });
  }
}

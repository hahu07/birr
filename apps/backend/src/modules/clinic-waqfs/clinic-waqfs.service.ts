import { LongTextField, NameField, TextField } from "../../common/validation/fields";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsOptional, Matches } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { CountryCode } from "../../common/validation/country-code";
import { deedTextHash, draftClinicDeedText } from "./clinic-waqf-deed";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DEED_TEXT_LIMIT = 20_000;

export class CreateClinicWaqfInput {
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

export class UpdateClinicWaqfInput {
  @IsOptional()
  @NameField()
  name?: string;

  @IsOptional()
  @NameField()
  city?: string;

  @IsOptional()
  @LongTextField()
  description?: string;
}

export class DraftClinicDeedInput {
  // Omitted: the standard wording (clinic-waqf-deed.ts), filled in for this clinic.
  @IsOptional()
  @LongTextField(DEED_TEXT_LIMIT)
  text?: string;
}

interface DeedApprovalPayload {
  deedId: string;
  textHash: string;
}

interface EstablishPayload {
  clinicWaqfId: string;
}

const userName = { select: { id: true, fullName: true } };

/**
 * The clinic waqf (2026-11-17, clinic slice 2): a waqf Birr itself
 * establishes for the Mother & Child Clinic, with a versioned deed and a
 * ledger that keeps the endowment and the running fund apart. A Mutawalli
 * Officer creates it and drafts its deed (clinic_waqf.manage); a Shariah
 * board member approves each deed version (clinic_waqf.deed_approve); the
 * Board of Trustees approves establishing it (clinic_waqf.establish). The
 * governed-action engine calls the approval methods below.
 */
@Injectable()
export class ClinicWaqfsService {
  async create(input: CreateClinicWaqfInput, actorUserId: string) {
    if (await prisma.clinicWaqf.findUnique({ where: { slug: input.slug } })) {
      throw new ConflictException(`The address "${input.slug}" is already used by another clinic waqf.`);
    }
    return prisma.$transaction(async (tx) => {
      const clinic = await tx.clinicWaqf.create({ data: { ...input, createdByUserId: actorUserId } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "clinic_waqf.created",
          entityType: "ClinicWaqf",
          entityId: clinic.id,
          after: clinic as any,
        },
      });
      return clinic;
    });
  }

  /** Name, city and description; the address and jurisdiction stay as set. */
  async update(id: string, input: UpdateClinicWaqfInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.clinicWaqf.findUnique({ where: { id } });
      if (!before) throw new NotFoundException(`Clinic waqf "${id}" not found.`);
      const after = await tx.clinicWaqf.update({ where: { id }, data: input });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "clinic_waqf.updated",
          entityType: "ClinicWaqf",
          entityId: id,
          before: before as any,
          after: after as any,
        },
      });
      return after;
    });
  }

  list() {
    return prisma.clinicWaqf.findMany({
      orderBy: { createdAt: "desc" },
      include: { deeds: { where: { status: "approved" }, select: { version: true } } },
    });
  }

  async findById(id: string) {
    const clinic = await prisma.clinicWaqf.findUnique({
      where: { id },
      include: {
        createdByUser: userName,
        deeds: { orderBy: { version: "desc" }, include: { createdByUser: userName } },
        operator: { select: { id: true, name: true, status: true } },
      },
    });
    if (!clinic) throw new NotFoundException(`Clinic waqf "${id}" not found.`);
    return clinic;
  }

  /** The standard wording, filled in for this clinic, to start a draft from. */
  async deedTemplate(id: string) {
    const clinic = await prisma.clinicWaqf.findUnique({ where: { id } });
    if (!clinic) throw new NotFoundException(`Clinic waqf "${id}" not found.`);
    return { text: draftClinicDeedText(clinic) };
  }

  /** A new version, as a draft. One open draft at a time; its text never changes once drafted. */
  async draftDeed(clinicWaqfId: string, input: DraftClinicDeedInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "clinic_waqfs" WHERE "id" = ${clinicWaqfId} FOR UPDATE`;
      const clinic = await tx.clinicWaqf.findUnique({ where: { id: clinicWaqfId } });
      if (!clinic) throw new NotFoundException(`Clinic waqf "${clinicWaqfId}" not found.`);
      const openDraft = await tx.clinicWaqfDeed.findFirst({ where: { clinicWaqfId, status: "draft" } });
      if (openDraft) {
        throw new ConflictException(`Version ${openDraft.version} is still a draft. Discard it, or have it approved, before drafting another.`);
      }
      const latest = await tx.clinicWaqfDeed.aggregate({ where: { clinicWaqfId }, _max: { version: true } });
      const text = (input.text ?? draftClinicDeedText(clinic)).replace(/\r\n/g, "\n");
      const deed = await tx.clinicWaqfDeed.create({
        data: {
          clinicWaqfId,
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
          action: "clinic_waqf_deed.drafted",
          entityType: "ClinicWaqfDeed",
          entityId: deed.id,
          after: deed as any,
        },
      });
      return deed;
    });
  }

  /** Drops a draft that won't be approved. Refused while its approval is waiting. */
  async discardDeed(clinicWaqfId: string, deedId: string, actorUserId: string) {
    if (await this.pendingAction("clinic_waqf.deed_approve", "deedId", deedId)) {
      throw new ConflictException("This draft is waiting for Shariah approval. Have the proposal rejected first.");
    }
    return prisma.$transaction(async (tx) => {
      const before = await tx.clinicWaqfDeed.findUnique({ where: { id: deedId } });
      if (!before || before.clinicWaqfId !== clinicWaqfId) throw new NotFoundException(`Deed version "${deedId}" not found.`);
      if (before.status !== "draft") throw new BadRequestException(`Version ${before.version} is ${before.status}, not a draft.`);
      const after = await tx.clinicWaqfDeed.update({ where: { id: deedId }, data: { status: "discarded" } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "clinic_waqf_deed.discarded",
          entityType: "ClinicWaqfDeed",
          entityId: deedId,
          before: before as any,
          after: after as any,
        },
      });
      return after;
    });
  }

  // ---- clinic_waqf.deed_approve (checker: shariah_board_member only) ----

  private parseDeedPayload(payload: unknown): DeedApprovalPayload {
    const p = (payload ?? {}) as Partial<Record<keyof DeedApprovalPayload, unknown>>;
    if (typeof p.deedId !== "string") throw new BadRequestException("payload.deedId is required.");
    if (typeof p.textHash !== "string") throw new BadRequestException("payload.textHash is required: the hash of the wording being approved.");
    return { deedId: p.deedId, textHash: p.textHash };
  }

  async validateDeedProposal(payload: unknown) {
    const { deedId, textHash } = this.parseDeedPayload(payload);
    const deed = await prisma.clinicWaqfDeed.findUnique({ where: { id: deedId } });
    if (!deed) throw new NotFoundException(`Deed version "${deedId}" not found.`);
    if (deed.status !== "draft") throw new BadRequestException(`Version ${deed.version} is ${deed.status}, not a draft.`);
    if (deed.textHash !== textHash) throw new BadRequestException("The wording has changed since it was shown. Reload it and propose again.");
  }

  async checkDuplicateDeedProposal(payload: unknown) {
    if (await this.pendingAction("clinic_waqf.deed_approve", "deedId", this.parseDeedPayload(payload).deedId)) {
      throw new ConflictException("This deed version is already waiting for Shariah approval — check the Approvals queue.");
    }
  }

  async describeDeedProposal(payload: unknown): Promise<string> {
    const deed = await prisma.clinicWaqfDeed.findUnique({
      where: { id: this.parseDeedPayload(payload).deedId },
      include: { clinicWaqf: { select: { name: true } } },
    });
    return deed ? `Version ${deed.version} of the deed of ${deed.clinicWaqf.name}` : "Deed version not found.";
  }

  /** What the Shariah approver reads: the full wording, and the version it would replace. */
  async currentDeedState(payload: unknown): Promise<Record<string, unknown>> {
    const deed = await prisma.clinicWaqfDeed.findUniqueOrThrow({ where: { id: this.parseDeedPayload(payload).deedId } });
    const approved = await prisma.clinicWaqfDeed.findFirst({ where: { clinicWaqfId: deed.clinicWaqfId, status: "approved" } });
    return {
      status: deed.status,
      version: deed.version,
      text: deed.text,
      replacesApprovedVersion: approved?.version ?? null,
    };
  }

  async approveDeed(payload: unknown, governedActionId: string, checkerUserId: string, tx: Prisma.TransactionClient) {
    const { deedId, textHash } = this.parseDeedPayload(payload);
    const found = await tx.clinicWaqfDeed.findUnique({ where: { id: deedId } });
    if (!found) throw new NotFoundException(`Deed version "${deedId}" not found.`);
    // The clinic's row orders approvals of its deed; every lock comes before any audit row.
    await tx.$queryRaw`SELECT "id" FROM "clinic_waqfs" WHERE "id" = ${found.clinicWaqfId} FOR UPDATE`;
    const draft = await tx.clinicWaqfDeed.findUniqueOrThrow({ where: { id: deedId } });
    if (draft.status !== "draft") throw new BadRequestException(`Version ${draft.version} is already ${draft.status}.`);
    if (draft.textHash !== textHash) throw new BadRequestException("The wording isn't the wording that was proposed.");

    const live = await tx.clinicWaqfDeed.findFirst({ where: { clinicWaqfId: draft.clinicWaqfId, status: "approved" } });
    // Superseded first: the database allows one approved version per clinic.
    const superseded = live ? await tx.clinicWaqfDeed.update({ where: { id: live.id }, data: { status: "superseded" } }) : null;
    const after = await tx.clinicWaqfDeed.update({
      where: { id: deedId },
      data: { status: "approved", approvedAt: new Date(), approvedActionId: governedActionId },
    });
    if (live && superseded) {
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId: checkerUserId,
          action: "clinic_waqf_deed.superseded",
          entityType: "ClinicWaqfDeed",
          entityId: live.id,
          before: live as any,
          after: superseded as any,
        },
      });
    }
    return { before: draft, after };
  }

  // ---- clinic_waqf.establish (checker: board_of_trustees only) ----

  private parseEstablishPayload(payload: unknown): EstablishPayload {
    const p = (payload ?? {}) as Partial<Record<keyof EstablishPayload, unknown>>;
    if (typeof p.clinicWaqfId !== "string") throw new BadRequestException("payload.clinicWaqfId is required.");
    return { clinicWaqfId: p.clinicWaqfId };
  }

  private async assertEstablishable(db: Prisma.TransactionClient | typeof prisma, clinicWaqfId: string) {
    const clinic = await db.clinicWaqf.findUnique({ where: { id: clinicWaqfId } });
    if (!clinic) throw new NotFoundException(`Clinic waqf "${clinicWaqfId}" not found.`);
    if (clinic.status !== "draft") throw new BadRequestException(`${clinic.name} is already established.`);
    const approved = await db.clinicWaqfDeed.findFirst({ where: { clinicWaqfId, status: "approved" } });
    if (!approved) throw new BadRequestException(`${clinic.name} has no approved deed yet. A Shariah board member must approve one first.`);
    return { clinic, approved };
  }

  async validateEstablishProposal(payload: unknown) {
    await this.assertEstablishable(prisma, this.parseEstablishPayload(payload).clinicWaqfId);
  }

  async checkDuplicateEstablishProposal(payload: unknown) {
    if (await this.pendingAction("clinic_waqf.establish", "clinicWaqfId", this.parseEstablishPayload(payload).clinicWaqfId)) {
      throw new ConflictException("Establishing this clinic waqf is already waiting for the Board — check the Approvals queue.");
    }
  }

  async describeEstablishProposal(payload: unknown): Promise<string> {
    const clinic = await prisma.clinicWaqf.findUnique({ where: { id: this.parseEstablishPayload(payload).clinicWaqfId } });
    return clinic ? `Establish ${clinic.name} (${clinic.city})` : "Clinic waqf not found.";
  }

  async currentEstablishState(payload: unknown): Promise<Record<string, unknown>> {
    const { clinicWaqfId } = this.parseEstablishPayload(payload);
    const clinic = await prisma.clinicWaqf.findUniqueOrThrow({ where: { id: clinicWaqfId } });
    const approved = await prisma.clinicWaqfDeed.findFirst({ where: { clinicWaqfId, status: "approved" } });
    return { status: clinic.status, city: clinic.city, jurisdiction: clinic.jurisdiction, approvedDeedVersion: approved?.version ?? null };
  }

  async establish(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const { clinicWaqfId } = this.parseEstablishPayload(payload);
    await tx.$queryRaw`SELECT "id" FROM "clinic_waqfs" WHERE "id" = ${clinicWaqfId} FOR UPDATE`;
    const { clinic: before } = await this.assertEstablishable(tx, clinicWaqfId);
    const after = await tx.clinicWaqf.update({
      where: { id: clinicWaqfId },
      data: { status: "established", establishedAt: new Date(), establishedActionId: governedActionId },
    });
    return { before, after };
  }

  private pendingAction(permissionKey: string, field: string, value: string) {
    return prisma.governedAction.findFirst({
      where: { status: "proposed", permission: { key: permissionKey }, payload: { path: [field], equals: value } },
    });
  }
}

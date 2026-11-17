import { LongTextField, NameField, ReferenceField, TextField } from "../../common/validation/fields";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString, IsOptional, Matches } from "class-validator";
import { ProgrammeAssetKind, prisma, Prisma } from "@birr/db";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { ClinicLedgerService } from "./clinic-ledger.service";
import { lagosToday } from "../counterparties/counterparty-licenses.service";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayMessage = (field: string) => ({ message: `${field} must be a date like 2027-01-31.` });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

export class RecordClinicAssetInput {
  @IsEnum(ProgrammeAssetKind)
  kind!: ProgrammeAssetKind;

  @NameField()
  name!: string;

  @IsOptional()
  @LongTextField()
  description?: string;

  // In naira, at its independent valuation.
  @IsNumberString()
  @IsPositiveDecimal()
  value!: string;

  // Who valued it and how, e.g. "Valued by Adeola & Co, report AV/2027/014; C of O OY/1234".
  @LongTextField()
  valuationNote!: string;

  @IsOptional()
  @NameField()
  donorName?: string;

  @Matches(DAY, dayMessage("acquiredOn"))
  acquiredOn!: string;

  @IsOptional()
  @ReferenceField()
  serialNumber?: string;

  @IsOptional()
  @TextField()
  location?: string;

  @IsOptional()
  @Matches(DAY, dayMessage("warrantyUntil"))
  warrantyUntil?: string;

  @IsOptional()
  @Matches(DAY, dayMessage("lastServicedOn"))
  lastServicedOn?: string;

  @IsOptional()
  @Matches(DAY, dayMessage("nextServiceDue"))
  nextServiceDue?: string;
}

/** Its care details, kept up to date by staff. What it is and its value never change. */
export class UpdateClinicAssetCareInput {
  @IsOptional()
  @LongTextField()
  description?: string;

  @IsOptional()
  @ReferenceField()
  serialNumber?: string;

  @IsOptional()
  @TextField()
  location?: string;

  @IsOptional()
  @Matches(DAY, dayMessage("warrantyUntil"))
  warrantyUntil?: string;

  @IsOptional()
  @Matches(DAY, dayMessage("lastServicedOn"))
  lastServicedOn?: string;

  @IsOptional()
  @Matches(DAY, dayMessage("nextServiceDue"))
  nextServiceDue?: string;
}

interface AddPayload {
  assetId: string;
}

interface DisposePayload {
  assetId: string;
  disposedOn: string;
  proceeds: string;
  note: string;
}

const naira = (amount: Prisma.Decimal | string) => `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A clinic waqf's asset register (2026-11-17, clinic slice 5a): land, a
 * building or equipment given in kind. A Mutawalli Officer records it at
 * its independent valuation; the Board of Trustees approves adding it to
 * the endowment (clinic_waqf.asset_add), which books it (1500 Premises and
 * equipment / 3000 Endowment capital). Disposing of one is the Board's
 * decision too (clinic_waqf.asset_dispose): any proceeds stay in the
 * endowment. The governed-action engine calls the approval methods.
 */
@Injectable()
export class ClinicAssetsService {
  constructor(private readonly ledger: ClinicLedgerService) {}

  async record(programmeId: string, input: RecordClinicAssetInput, actorUserId: string) {
    const value = new Prisma.Decimal(input.value);
    if (value.decimalPlaces() > 2) throw new BadRequestException("Enter the value in naira and kobo.");
    if (input.acquiredOn > lagosToday()) throw new BadRequestException("The date it was given can't be in the future.");
    return prisma.$transaction(async (tx) => {
      const clinic = await tx.waqfProgramme.findUnique({ where: { id: programmeId } });
      if (!clinic) throw new NotFoundException(`Clinic waqf "${programmeId}" not found.`);
      const asset = await tx.programmeAsset.create({
        data: {
          programmeId,
          kind: input.kind,
          name: input.name,
          description: input.description,
          value,
          valuationNote: input.valuationNote,
          donorName: input.donorName,
          acquiredOn: asDate(input.acquiredOn),
          serialNumber: input.serialNumber,
          location: input.location,
          warrantyUntil: input.warrantyUntil ? asDate(input.warrantyUntil) : undefined,
          lastServicedOn: input.lastServicedOn ? asDate(input.lastServicedOn) : undefined,
          nextServiceDue: input.nextServiceDue ? asDate(input.nextServiceDue) : undefined,
          createdByUserId: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_asset.recorded", entityType: "ProgrammeAsset", entityId: asset.id, after: asset as any },
      });
      return asset;
    });
  }

  async updateCare(programmeId: string, assetId: string, input: UpdateClinicAssetCareInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.programmeAsset.findUnique({ where: { id: assetId } });
      if (!before || before.programmeId !== programmeId) throw new NotFoundException(`Asset "${assetId}" not found.`);
      if (before.status === "rejected" || before.status === "disposed") throw new BadRequestException(`This asset is ${before.status}, so it can't be changed.`);
      const after = await tx.programmeAsset.update({
        where: { id: assetId },
        data: {
          description: input.description,
          serialNumber: input.serialNumber,
          location: input.location,
          warrantyUntil: input.warrantyUntil ? asDate(input.warrantyUntil) : undefined,
          lastServicedOn: input.lastServicedOn ? asDate(input.lastServicedOn) : undefined,
          nextServiceDue: input.nextServiceDue ? asDate(input.nextServiceDue) : undefined,
        },
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_asset.care_updated", entityType: "ProgrammeAsset", entityId: assetId, before: before as any, after: after as any },
      });
      return after;
    });
  }

  list(programmeId: string) {
    return prisma.programmeAsset.findMany({
      where: { programmeId },
      orderBy: [{ status: "asc" }, { acquiredOn: "desc" }],
      include: { createdByUser: { select: { id: true, fullName: true } } },
    });
  }

  private pendingAction(permissionKey: string, assetId: string) {
    return prisma.governedAction.findFirst({
      where: { status: "proposed", permission: { key: permissionKey }, payload: { path: ["assetId"], equals: assetId } },
    });
  }

  private async findOrThrow(id: unknown, db: Prisma.TransactionClient | typeof prisma = prisma) {
    if (typeof id !== "string") throw new BadRequestException("payload.assetId is required.");
    const asset = await db.programmeAsset.findUnique({ where: { id }, include: { programme: { select: { name: true, status: true } } } });
    if (!asset) throw new NotFoundException(`Asset "${id}" not found.`);
    return asset;
  }

  // ---- clinic_waqf.asset_add (checker: board_of_trustees) ----

  async validateAddProposal(payload: unknown) {
    const asset = await this.findOrThrow((payload as Partial<AddPayload>)?.assetId);
    if (asset.status !== "proposed") throw new BadRequestException(`This asset is already ${asset.status}.`);
    if (asset.programme.status !== "established") throw new BadRequestException(`${asset.programme.name} isn't established yet, so it has no endowment to add to.`);
  }

  async checkDuplicateAdd(payload: unknown) {
    if (await this.pendingAction("clinic_waqf.asset_add", (payload as AddPayload).assetId)) {
      throw new ConflictException("Adding this asset is already waiting for the Board — check the Approvals queue.");
    }
  }

  async describeAdd(payload: unknown): Promise<string> {
    const a = await this.findOrThrow((payload as AddPayload).assetId);
    return `Add ${a.name} (${a.kind}) to the endowment of ${a.programme.name} at ${naira(a.value)}${a.donorName ? `, given by ${a.donorName}` : ""}. Valuation: ${a.valuationNote}`;
  }

  async currentAddState(payload: unknown): Promise<Record<string, unknown>> {
    const a = await this.findOrThrow((payload as AddPayload).assetId);
    return { status: a.status, value: a.value.toFixed(2), valuationNote: a.valuationNote, acquiredOn: a.acquiredOn.toISOString().slice(0, 10) };
  }

  async approveAdd(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const { assetId } = payload as AddPayload;
    const before = await this.findOrThrow(assetId, tx);
    if (before.status !== "proposed") throw new BadRequestException(`This asset is already ${before.status}.`);
    if (before.programme.status !== "established") throw new BadRequestException(`${before.programme.name} isn't established yet.`);
    const claim = await tx.programmeAsset.updateMany({ where: { id: assetId, status: "proposed" }, data: { status: "active", approvalActionId: governedActionId } });
    if (claim.count !== 1) throw new BadRequestException("This asset changed just now.");
    await this.ledger.post(tx, {
      programmeId: before.programmeId,
      description: `${before.name}, given in kind, added to the endowment`,
      currency: "NGN",
      source: "asset_added",
      sourceId: assetId,
      actorType: "system",
      lines: [
        { accountCode: "1500", debit: before.value },
        { accountCode: "3000", credit: before.value },
      ],
    });
    const { programme: _c, ...beforeRow } = before;
    return { before: beforeRow, after: await tx.programmeAsset.findUniqueOrThrow({ where: { id: assetId } }) };
  }

  async rejectAdd(payload: unknown, tx: Prisma.TransactionClient) {
    const { assetId } = payload as AddPayload;
    const before = await tx.programmeAsset.findUnique({ where: { id: assetId } });
    if (!before || before.status !== "proposed") return null;
    const after = await tx.programmeAsset.update({ where: { id: assetId }, data: { status: "rejected" } });
    return { before, after };
  }

  // ---- clinic_waqf.asset_dispose (checker: board_of_trustees) ----

  validateDisposeProposal(payload: unknown): DisposePayload {
    const p = (payload ?? {}) as Partial<Record<keyof DisposePayload, unknown>>;
    if (typeof p.assetId !== "string") throw new BadRequestException("payload.assetId is required.");
    if (typeof p.disposedOn !== "string" || !DAY.test(p.disposedOn)) throw new BadRequestException('payload.disposedOn must be a date like "2027-02-12".');
    if (p.disposedOn > lagosToday()) throw new BadRequestException("The disposal date can't be in the future.");
    const proceeds = typeof p.proceeds === "string" && /^\d+(\.\d{1,2})?$/.test(p.proceeds) ? p.proceeds : null;
    if (proceeds === null) throw new BadRequestException("payload.proceeds must be what the sale or exchange brought in, in naira (0 if scrapped).");
    const note = typeof p.note === "string" ? p.note.trim() : "";
    if (note.length < 10 || note.length > 2000) throw new BadRequestException("payload.note must say why, and how it was disposed of, in a sentence or more.");
    return { assetId: p.assetId, disposedOn: p.disposedOn, proceeds, note };
  }

  async validateDisposeProposalAsync(payload: unknown) {
    const p = this.validateDisposeProposal(payload);
    const asset = await this.findOrThrow(p.assetId);
    if (asset.status !== "active") throw new BadRequestException(`Only an asset in the endowment can be disposed of (this one is ${asset.status}).`);
  }

  async checkDuplicateDispose(payload: unknown) {
    if (await this.pendingAction("clinic_waqf.asset_dispose", (payload as DisposePayload).assetId)) {
      throw new ConflictException("Disposing of this asset is already waiting for the Board — check the Approvals queue.");
    }
  }

  async describeDispose(payload: unknown): Promise<string> {
    const p = payload as DisposePayload;
    const a = await this.findOrThrow(p.assetId);
    return `Dispose of ${a.name} from ${a.programme.name} on ${p.disposedOn} (valued at ${naira(a.value)}), bringing ${naira(p.proceeds)} into the endowment. Why: ${p.note}`;
  }

  async currentDisposeState(payload: unknown): Promise<Record<string, unknown>> {
    const a = await this.findOrThrow((payload as DisposePayload).assetId);
    return { status: a.status, value: a.value.toFixed(2), kind: a.kind };
  }

  /**
   * The asset leaves the register at the value it was booked at; any
   * proceeds come into endowment cash; the difference is a gain or loss to
   * the endowment's capital. All within the endowment, so it balances there.
   */
  async approveDispose(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const p = this.validateDisposeProposal(payload);
    const before = await this.findOrThrow(p.assetId, tx);
    if (before.status !== "active") throw new BadRequestException(`This asset is ${before.status}, not in the endowment.`);
    const proceeds = new Prisma.Decimal(p.proceeds);
    const claim = await tx.programmeAsset.updateMany({
      where: { id: p.assetId, status: "active" },
      data: { status: "disposed", disposalActionId: governedActionId, disposedOn: asDate(p.disposedOn), disposalProceeds: proceeds, disposalNote: p.note },
    });
    if (claim.count !== 1) throw new BadRequestException("This asset changed just now.");
    const difference = before.value.minus(proceeds);
    await this.ledger.post(tx, {
      programmeId: before.programmeId,
      description: `${before.name} disposed of`,
      currency: "NGN",
      source: "asset_disposed",
      sourceId: p.assetId,
      actorType: "system",
      lines: [
        { accountCode: "1500", credit: before.value },
        ...(proceeds.gt(0) ? [{ accountCode: "1000", debit: proceeds }] : []),
        ...(difference.gt(0) ? [{ accountCode: "3000", debit: difference }] : []),
        ...(difference.lt(0) ? [{ accountCode: "3000", credit: difference.negated() }] : []),
      ],
    });
    const { programme: _c, ...beforeRow } = before;
    return { before: beforeRow, after: await tx.programmeAsset.findUniqueOrThrow({ where: { id: p.assetId } }) };
  }
}

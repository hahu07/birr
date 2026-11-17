import { IdField, LongTextField, NameField, ReferenceField } from "../../common/validation/fields";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString, IsOptional } from "class-validator";
import { ClinicSpendKind, ClinicWorksRoute, prisma, Prisma } from "@birr/db";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { ClinicLedgerService } from "./clinic-ledger.service";
import { lagosToday } from "../counterparties/counterparty-licenses.service";

type Db = Prisma.TransactionClient | typeof prisma;

export class ProposeClinicWorksInput {
  @NameField()
  name!: string;

  @IsEnum(ClinicWorksRoute)
  route!: ClinicWorksRoute;

  @IdField()
  contractorId!: string;

  @IsNumberString()
  @IsPositiveDecimal()
  budget!: string;

  // The quantity surveyor's costing, and the comparison behind the route.
  @LongTextField()
  budgetNote!: string;
}

export class CreateClinicSpendInput {
  @IsEnum(ClinicSpendKind)
  kind!: ClinicSpendKind;

  @IsOptional()
  @IdField()
  worksProjectId?: string;

  @IdField()
  payeeId!: string;

  @LongTextField()
  description!: string;

  @IsNumberString()
  @IsPositiveDecimal()
  amount!: string;

  // The supplier's invoice number, or the engineer's certificate for a works stage.
  @ReferenceField()
  supportingReference!: string;
}

const naira = (amount: Prisma.Decimal | string) => `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const COMMITTED = ["pending_approval", "approved"] as const;

/**
 * A clinic waqf's endowment spending (2026-11-17, clinic slice 5b): endowment
 * cash turned into the endowment's own premises and equipment, so it stays
 * in the endowment (1500 / 1000).
 *
 * - Works projects: the Board approves the route, contractor and budget
 *   (clinic_waqf.works_approve).
 * - Payments: a Mutawalli Officer proposes one (equipment, or a works stage
 *   against the engineer's certificate); the Board or Compliance approves
 *   it (clinic_waqf.spend_approve); it's paid by bank transfer from the
 *   clinic waqf's account; a second person confirms the bank reference
 *   (clinic_waqf.spend_mark_paid), which books it and, for equipment, adds
 *   the asset to the register.
 * - Limits, under the clinic's row lock: what's committed (proposed or
 *   approved, not yet paid) never exceeds the endowment's cash, and a
 *   project's stages never exceed its budget.
 */
@Injectable()
export class ClinicSpendingService {
  constructor(private readonly ledger: ClinicLedgerService) {}

  // ---- Works projects ----

  async proposeWorks(clinicWaqfId: string, input: ProposeClinicWorksInput, actorUserId: string) {
    const budget = new Prisma.Decimal(input.budget);
    if (budget.decimalPlaces() > 2) throw new BadRequestException("Enter the budget in naira and kobo.");
    const clinic = await prisma.clinicWaqf.findUnique({ where: { id: clinicWaqfId } });
    if (!clinic) throw new NotFoundException(`Clinic waqf "${clinicWaqfId}" not found.`);
    await this.activeCounterparty(input.contractorId, "contractor");
    return prisma.$transaction(async (tx) => {
      const project = await tx.clinicWorksProject.create({
        data: { clinicWaqfId, name: input.name, route: input.route, contractorId: input.contractorId, budget, budgetNote: input.budgetNote, createdByUserId: actorUserId },
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_works.proposed", entityType: "ClinicWorksProject", entityId: project.id, after: project as any },
      });
      return project;
    });
  }

  listWorks(clinicWaqfId: string) {
    return prisma.clinicWorksProject.findMany({
      where: { clinicWaqfId },
      orderBy: { createdAt: "desc" },
      include: { contractor: { select: { id: true, name: true } }, spends: { where: { status: { not: "rejected" } }, select: { amount: true, status: true } } },
    });
  }

  private async findWorks(id: unknown, db: Db = prisma) {
    if (typeof id !== "string") throw new BadRequestException("payload.worksProjectId is required.");
    const project = await db.clinicWorksProject.findUnique({ where: { id }, include: { contractor: true, clinicWaqf: { select: { name: true } } } });
    if (!project) throw new NotFoundException(`Works project "${id}" not found.`);
    return project;
  }

  async validateWorksProposal(payload: unknown) {
    const p = await this.findWorks((payload as { worksProjectId?: unknown })?.worksProjectId);
    if (p.status !== "proposed") throw new BadRequestException(`This works project is already ${p.status}.`);
  }

  async checkDuplicateWorks(payload: unknown) {
    if (await this.pending("clinic_waqf.works_approve", "worksProjectId", (payload as { worksProjectId: string }).worksProjectId)) {
      throw new ConflictException("This works project is already waiting for the Board — check the Approvals queue.");
    }
  }

  async describeWorks(payload: unknown): Promise<string> {
    const p = await this.findWorks((payload as { worksProjectId: string }).worksProjectId);
    return `${p.name} at ${p.clinicWaqf.name}: ${p.route.replace(/_/g, " ")}, by ${p.contractor.name}, budget ${naira(p.budget)}. Costing: ${p.budgetNote}`;
  }

  async currentWorksState(payload: unknown): Promise<Record<string, unknown>> {
    const p = await this.findWorks((payload as { worksProjectId: string }).worksProjectId);
    return { status: p.status, contractorStatus: p.contractor.status, budget: p.budget.toFixed(2) };
  }

  async approveWorks(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const before = await this.findWorks((payload as { worksProjectId: string }).worksProjectId, tx);
    if (before.status !== "proposed") throw new BadRequestException(`This works project is already ${before.status}.`);
    if (before.contractor.status !== "active" || before.contractor.deletedAt) throw new BadRequestException(`${before.contractor.name} is no longer an active, vetted partner.`);
    const after = await tx.clinicWorksProject.update({ where: { id: before.id }, data: { status: "approved", approvalActionId: governedActionId } });
    const { contractor: _c, clinicWaqf: _w, ...beforeRow } = before;
    return { before: beforeRow, after };
  }

  async rejectWorks(payload: unknown, tx: Prisma.TransactionClient) {
    const before = await tx.clinicWorksProject.findUnique({ where: { id: (payload as { worksProjectId: string }).worksProjectId } });
    if (!before || before.status !== "proposed") return null;
    return { before, after: await tx.clinicWorksProject.update({ where: { id: before.id }, data: { status: "rejected" } }) };
  }

  // ---- Payments ----

  /** What a payment may still commit: the endowment's cash, less what's already committed and not yet paid. */
  private async headroom(db: Db, clinicWaqfId: string) {
    const cash = await db.clinicJournalEntryLine.aggregate({
      where: { journalEntry: { clinicWaqfId, currency: "NGN" }, ledgerAccount: { code: "1000" } },
      _sum: { debit: true, credit: true },
    });
    const balance = (cash._sum.debit ?? new Prisma.Decimal(0)).minus(cash._sum.credit ?? 0);
    const committed = await db.clinicSpend.aggregate({ where: { clinicWaqfId, status: { in: [...COMMITTED] } }, _sum: { amount: true } });
    return { balance, committed: committed._sum.amount ?? new Prisma.Decimal(0) };
  }

  /** A project's stages so far (not rejected), against its budget. */
  private async projectSpent(db: Db, worksProjectId: string) {
    const spent = await db.clinicSpend.aggregate({ where: { worksProjectId, status: { not: "rejected" } }, _sum: { amount: true } });
    return spent._sum.amount ?? new Prisma.Decimal(0);
  }

  private async activeCounterparty(id: string, role: string) {
    const counterparty = await prisma.counterparty.findUnique({ where: { id } });
    if (!counterparty || counterparty.deletedAt) throw new NotFoundException(`The ${role} wasn't found.`);
    if (counterparty.status !== "active") throw new BadRequestException(`${counterparty.name} isn't an active, vetted partner (status: ${counterparty.status}).`);
    return counterparty;
  }

  async createSpend(clinicWaqfId: string, input: CreateClinicSpendInput, actorUserId: string) {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.decimalPlaces() > 2) throw new BadRequestException("Enter the amount in naira and kobo.");
    if (input.kind === "works_stage" && !input.worksProjectId) throw new BadRequestException("Choose the works project this stage belongs to.");
    if (input.kind === "equipment" && input.worksProjectId) throw new BadRequestException("Equipment isn't part of a works project.");
    const payee = await this.activeCounterparty(input.payeeId, "payee");

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "clinic_waqfs" WHERE "id" = ${clinicWaqfId} FOR UPDATE`;
      const clinic = await tx.clinicWaqf.findUnique({ where: { id: clinicWaqfId } });
      if (!clinic) throw new NotFoundException(`Clinic waqf "${clinicWaqfId}" not found.`);
      if (clinic.status !== "established") throw new BadRequestException(`${clinic.name} isn't established yet.`);
      if (input.worksProjectId) {
        const project = await tx.clinicWorksProject.findUnique({ where: { id: input.worksProjectId } });
        if (!project || project.clinicWaqfId !== clinicWaqfId) throw new NotFoundException("Works project not found.");
        if (project.status !== "approved") throw new BadRequestException("The Board hasn't approved this works project yet.");
        if (project.contractorId !== payee.id) throw new BadRequestException("A works stage is paid to the project's own contractor.");
        const spent = await this.projectSpent(tx, project.id);
        if (spent.plus(amount).gt(project.budget)) {
          throw new BadRequestException(`That would take the project past its budget: ${naira(project.budget.minus(spent))} of ${naira(project.budget)} is left.`);
        }
      }
      const { balance, committed } = await this.headroom(tx, clinicWaqfId);
      if (committed.plus(amount).gt(balance)) {
        throw new BadRequestException(`Only ${naira(balance.minus(committed))} of the endowment's cash is free to commit.`);
      }
      const spend = await tx.clinicSpend.create({
        data: {
          clinicWaqfId,
          kind: input.kind,
          worksProjectId: input.worksProjectId,
          payeeId: payee.id,
          description: input.description,
          amount,
          supportingReference: input.supportingReference,
          createdByUserId: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_spend.created", entityType: "ClinicSpend", entityId: spend.id, after: spend as any },
      });
      return spend;
    });
  }

  listSpends(clinicWaqfId: string) {
    return prisma.clinicSpend.findMany({
      where: { clinicWaqfId },
      orderBy: { createdAt: "desc" },
      include: { payee: { select: { id: true, name: true } }, worksProject: { select: { id: true, name: true } } },
    });
  }

  private async findSpend(id: unknown, db: Db = prisma) {
    if (typeof id !== "string") throw new BadRequestException("payload.spendId is required.");
    const spend = await db.clinicSpend.findUnique({ where: { id }, include: { payee: true, clinicWaqf: { select: { name: true } }, worksProject: true } });
    if (!spend) throw new NotFoundException(`Payment "${id}" not found.`);
    return spend;
  }

  // ---- clinic_waqf.spend_approve (checkers: Board, Compliance) ----

  async validateSpendProposal(payload: unknown) {
    const s = await this.findSpend((payload as { spendId?: unknown })?.spendId);
    if (s.status !== "pending_approval") throw new BadRequestException(`This payment is already ${s.status.replace("_", " ")}.`);
  }

  async checkDuplicateSpend(payload: unknown) {
    if (await this.pending("clinic_waqf.spend_approve", "spendId", (payload as { spendId: string }).spendId)) {
      throw new ConflictException("This payment is already waiting for approval — check the Approvals queue.");
    }
  }

  async describeSpend(payload: unknown): Promise<string> {
    const s = await this.findSpend((payload as { spendId: string }).spendId);
    const what = s.kind === "works_stage" ? `a stage of ${s.worksProject!.name} (engineer's certificate ${s.supportingReference})` : `equipment (invoice ${s.supportingReference})`;
    return `${naira(s.amount)} from ${s.clinicWaqf.name}'s endowment cash to ${s.payee.name}, for ${what}: ${s.description}`;
  }

  /** What the approver weighs: the endowment's cash and, for a works stage, the budget. */
  async currentSpendState(payload: unknown): Promise<Record<string, unknown>> {
    const s = await this.findSpend((payload as { spendId: string }).spendId);
    const { balance, committed } = await this.headroom(prisma, s.clinicWaqfId);
    return {
      status: s.status,
      payeeStatus: s.payee.status,
      endowmentCash: balance.toFixed(2),
      committedIncludingThis: committed.toFixed(2),
      ...(s.worksProject && { projectBudget: s.worksProject.budget.toFixed(2), projectCommittedIncludingThis: (await this.projectSpent(prisma, s.worksProject.id)).toFixed(2) }),
    };
  }

  async approveSpend(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const { spendId } = payload as { spendId: string };
    const found = await this.findSpend(spendId, tx);
    await tx.$queryRaw`SELECT "id" FROM "clinic_waqfs" WHERE "id" = ${found.clinicWaqfId} FOR UPDATE`;
    const before = await this.findSpend(spendId, tx);
    if (before.status !== "pending_approval") throw new BadRequestException(`This payment is already ${before.status}.`);
    if (before.payee.status !== "active" || before.payee.deletedAt) throw new BadRequestException(`${before.payee.name} is no longer an active, vetted partner.`);
    // It's already counted as committed: re-check nothing has pushed commitments past the cash since.
    const { balance, committed } = await this.headroom(tx, before.clinicWaqfId);
    if (committed.gt(balance)) throw new BadRequestException(`Approving this would commit more than the endowment's cash (${naira(balance)}).`);
    const after = await tx.clinicSpend.update({ where: { id: spendId }, data: { status: "approved", approvalActionId: governedActionId, approvedAt: new Date() } });
    const { payee: _p, clinicWaqf: _c, worksProject: _w, ...beforeRow } = before;
    return { before: beforeRow, after };
  }

  async rejectSpend(payload: unknown, tx: Prisma.TransactionClient) {
    const before = await tx.clinicSpend.findUnique({ where: { id: (payload as { spendId: string }).spendId } });
    if (!before || before.status !== "pending_approval") return null;
    return { before, after: await tx.clinicSpend.update({ where: { id: before.id }, data: { status: "rejected" } }) };
  }

  // ---- clinic_waqf.spend_mark_paid (checkers: Compliance, Audit Committee) ----

  validatePaidProposal(payload: unknown) {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (typeof p.spendId !== "string") throw new BadRequestException("payload.spendId is required.");
    const bankReference = typeof p.bankReference === "string" ? p.bankReference.trim() : "";
    if (bankReference.length < 3 || bankReference.length > 100) throw new BadRequestException("payload.bankReference must be the bank's reference for the transfer.");
    if (typeof p.paidOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn)) throw new BadRequestException('payload.paidOn must be a date like "2027-02-12".');
    if (p.paidOn > lagosToday()) throw new BadRequestException(`payload.paidOn (${p.paidOn}) is in the future.`);
    return { spendId: p.spendId, bankReference, paidOn: p.paidOn };
  }

  async validatePaidProposalAsync(payload: unknown) {
    const p = this.validatePaidProposal(payload);
    const s = await this.findSpend(p.spendId);
    if (s.status !== "approved") throw new BadRequestException(`Only an approved payment can be marked paid (this one is ${s.status}).`);
    if (s.approvedAt && p.paidOn < s.approvedAt.toISOString().slice(0, 10)) throw new BadRequestException("The payment date is before it was approved.");
  }

  async checkDuplicatePaid(payload: unknown) {
    if (await this.pending("clinic_waqf.spend_mark_paid", "spendId", (payload as { spendId: string }).spendId)) {
      throw new ConflictException("This payment is already waiting for confirmation.");
    }
  }

  async describePaid(payload: unknown): Promise<string> {
    const p = this.validatePaidProposal(payload);
    const s = await this.findSpend(p.spendId);
    return `Paid ${naira(s.amount)} to ${s.payee.name} from ${s.clinicWaqf.name}'s account on ${p.paidOn}, bank reference ${p.bankReference}. Check it against the bank statement before confirming.`;
  }

  /**
   * Books it (1500 / 1000, both endowment) and, for equipment, adds what
   * it bought to the asset register at what it cost. Locks the clinic row
   * first; the engine writes its audit row after.
   */
  async markPaid(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const p = this.validatePaidProposal(payload);
    const found = await this.findSpend(p.spendId, tx);
    await tx.$queryRaw`SELECT "id" FROM "clinic_waqfs" WHERE "id" = ${found.clinicWaqfId} FOR UPDATE`;
    const before = await this.findSpend(p.spendId, tx);
    if (before.status !== "approved") throw new BadRequestException(`Only an approved payment can be marked paid (this one is ${before.status}).`);
    const paidOn = new Date(`${p.paidOn}T00:00:00Z`);
    const asset =
      before.kind === "equipment"
        ? await tx.clinicAsset.create({
            data: {
              clinicWaqfId: before.clinicWaqfId,
              kind: "equipment",
              name: before.description.slice(0, 200),
              value: before.amount,
              valuationNote: `Bought from ${before.payee.name}, invoice ${before.supportingReference}, bank reference ${p.bankReference}.`,
              acquiredOn: paidOn,
              acquisition: "purchased",
              status: "active",
              approvalActionId: before.approvalActionId,
              createdByUserId: before.createdByUserId,
            },
          })
        : null;
    const after = await tx.clinicSpend.update({
      where: { id: p.spendId },
      data: { status: "paid", paymentActionId: governedActionId, paidOn, bankReference: p.bankReference, assetId: asset?.id },
    });
    await this.ledger.post(tx, {
      clinicWaqfId: before.clinicWaqfId,
      description: before.kind === "works_stage" ? `${before.worksProject!.name}: certified stage paid` : `Equipment bought: ${before.description.slice(0, 120)}`,
      currency: "NGN",
      source: "spend_paid",
      sourceId: before.id,
      actorType: "system",
      lines: [
        { accountCode: "1500", debit: before.amount },
        { accountCode: "1000", credit: before.amount },
      ],
    });
    const { payee: _p, clinicWaqf: _c, worksProject: _w, ...beforeRow } = before;
    return { before: beforeRow, after };
  }

  private pending(permissionKey: string, field: string, value: string) {
    return prisma.governedAction.findFirst({
      where: { status: "proposed", permission: { key: permissionKey }, payload: { path: [field], equals: value } },
    });
  }
}

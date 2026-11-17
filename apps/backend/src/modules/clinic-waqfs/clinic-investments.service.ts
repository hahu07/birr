import { IdField, LongTextField, NameField, ReferenceField } from "../../common/validation/fields";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsIn, IsNumberString, Matches } from "class-validator";
import { InvestmentInstrumentType, prisma, Prisma } from "@birr/db";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";
import { ClinicLedgerService } from "./clinic-ledger.service";
import { ClinicSpendingService } from "./clinic-spending.service";
import { ClinicReserveService } from "./clinic-reserve.service";
import { lagosToday } from "../counterparties/counterparty-licenses.service";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

export class CreateClinicInvestmentInput {
  @IdField()
  counterpartyId!: string;

  @NameField()
  name!: string;

  @IsEnum(InvestmentInstrumentType)
  instrumentType!: InvestmentInstrumentType;

  @IsNumberString()
  @IsPositiveDecimal()
  amount!: string;

  // What the money does, for the Shariah reviewer.
  @LongTextField()
  businessDescription!: string;
}

export class ScreenClinicInvestmentInput {
  @IsIn(["approved", "rejected"])
  decision!: "approved" | "rejected";

  @LongTextField()
  note!: string;
}

export class PlaceClinicInvestmentInput {
  // The placement agreement or term sheet's reference.
  @ReferenceField()
  agreementReference!: string;
}

export class RecordClinicInvestmentIncomeInput {
  @IsNumberString()
  @IsPositiveDecimal()
  amount!: string;

  @Matches(DAY, { message: "receivedOn must be a date like 2027-01-31." })
  receivedOn!: string;

  @ReferenceField()
  bankReference!: string;

  @LongTextField()
  description!: string;
}

export class RecordClinicInvestmentReturnInput {
  @Matches(DAY, { message: "returnedOn must be a date like 2027-01-31." })
  returnedOn!: string;

  @ReferenceField()
  bankReference!: string;
}

/**
 * A clinic waqf's investments (2026-11-17, clinic slice 5c): endowed cash
 * invested for income. The principal stays in the endowment (1200), and
 * only the income is spent, earned straight into the running fund (1100 /
 * 4100) — the two pots never mix. The Investment Committee records one; a
 * Shariah board member screens it (never whoever recorded it, also a
 * CHECK); placing it is an endowment payment (ClinicSpendingService,
 * approved and confirmed by others); when it matures the principal comes
 * back to endowment cash (1000 / 1200).
 */
@Injectable()
export class ClinicInvestmentsService {
  constructor(
    private readonly ledger: ClinicLedgerService,
    private readonly spending: ClinicSpendingService,
    private readonly reserve: ClinicReserveService,
  ) {}

  async create(programmeId: string, input: CreateClinicInvestmentInput, actorUserId: string) {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.decimalPlaces() > 2) throw new BadRequestException("Enter the amount in naira and kobo.");
    const clinic = await prisma.waqfProgramme.findUnique({ where: { id: programmeId } });
    if (!clinic) throw new NotFoundException(`Clinic waqf "${programmeId}" not found.`);
    if (clinic.status !== "established") throw new BadRequestException(`${clinic.name} isn't established yet.`);
    const counterparty = await prisma.counterparty.findUnique({ where: { id: input.counterpartyId } });
    if (!counterparty || counterparty.deletedAt) throw new NotFoundException("Counterparty not found.");
    if (counterparty.status !== "active") throw new BadRequestException(`${counterparty.name} isn't an active, vetted counterparty.`);
    return prisma.$transaction(async (tx) => {
      const investment = await tx.programmeInvestment.create({
        data: { programmeId, counterpartyId: counterparty.id, name: input.name, instrumentType: input.instrumentType, amount, businessDescription: input.businessDescription, createdByUserId: actorUserId },
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_investment.recorded", entityType: "ProgrammeInvestment", entityId: investment.id, after: investment as any },
      });
      return investment;
    });
  }

  /** A Shariah board member's decision. Never whoever recorded it. */
  async screen(programmeId: string, investmentId: string, input: ScreenClinicInvestmentInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await this.find(tx, programmeId, investmentId);
      if (before.status !== "pending_shariah_review") throw new ConflictException("This investment's Shariah screening has already been decided.");
      if (before.createdByUserId === actorUserId) throw new ForbiddenException("You recorded this investment, so someone else must screen it.");
      const after = await tx.programmeInvestment.update({
        where: { id: investmentId },
        data: {
          status: input.decision === "approved" ? "shariah_approved" : "shariah_rejected",
          shariahDecidedByUserId: actorUserId,
          shariahDecidedAt: new Date(),
          shariahNote: input.note,
        },
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: `clinic_investment.shariah_${input.decision}`, entityType: "ProgrammeInvestment", entityId: investmentId, before: before as any, after: after as any },
      });
      return after;
    });
  }

  /** Proposes the endowment payment that places it; the Board or Compliance then approves it. */
  async proposePlacement(programmeId: string, investmentId: string, input: PlaceClinicInvestmentInput, actorUserId: string) {
    const investment = await this.find(prisma, programmeId, investmentId);
    return this.spending.createSpend(
      programmeId,
      {
        kind: "investment",
        investmentId,
        payeeId: investment.counterpartyId,
        description: `Placing ${investment.name}`,
        amount: investment.amount.toFixed(2),
        supportingReference: input.agreementReference,
      },
      actorUserId,
    );
  }

  /** Income it paid: into the running fund, never the endowment. */
  async recordIncome(programmeId: string, investmentId: string, input: RecordClinicInvestmentIncomeInput, actorUserId: string) {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.decimalPlaces() > 2) throw new BadRequestException("Enter the amount in naira and kobo.");
    if (input.receivedOn > lagosToday()) throw new BadRequestException("The date it was received can't be in the future.");
    return prisma.$transaction(async (tx) => {
      const investment = await this.find(tx, programmeId, investmentId);
      if (investment.status !== "placed" && investment.status !== "returned") throw new BadRequestException("Income can only come from an investment that was placed.");
      const income = await tx.programmeInvestmentIncome.create({
        data: { investmentId, amount, receivedOn: asDate(input.receivedOn), bankReference: input.bankReference, description: input.description, recordedByUserId: actorUserId },
      });
      await this.ledger.post(tx, {
        programmeId,
        description: `Income from ${investment.name}`,
        currency: "NGN",
        source: "investment_income",
        sourceId: income.id,
        actorType: "birr_staff",
        actorUserId,
        lines: [
          { accountCode: "1100", debit: amount },
          { accountCode: "4100", credit: amount },
        ],
      });
      // The equipment replacement reserve's share, set aside at once (slice 9).
      await this.reserve.setAsideFromIncome(tx, programmeId, income.id, amount);
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_investment.income_recorded", entityType: "ProgrammeInvestmentIncome", entityId: income.id, after: income as any },
      });
      return income;
    });
  }

  /** The principal came back to endowment cash, in full. */
  async recordReturn(programmeId: string, investmentId: string, input: RecordClinicInvestmentReturnInput, actorUserId: string) {
    if (input.returnedOn > lagosToday()) throw new BadRequestException("The date it came back can't be in the future.");
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${programmeId} FOR UPDATE`;
      const before = await this.find(tx, programmeId, investmentId);
      if (before.status !== "placed") throw new BadRequestException(`Only a placed investment can come back (this one is ${before.status.replace(/_/g, " ")}).`);
      const after = await tx.programmeInvestment.update({
        where: { id: investmentId },
        data: { status: "returned", returnedOn: asDate(input.returnedOn), returnBankReference: input.bankReference },
      });
      await this.ledger.post(tx, {
        programmeId,
        description: `${before.name}: principal returned`,
        currency: "NGN",
        source: "investment_returned",
        sourceId: investmentId,
        actorType: "birr_staff",
        actorUserId,
        lines: [
          { accountCode: "1000", debit: before.amount },
          { accountCode: "1200", credit: before.amount },
        ],
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_investment.returned", entityType: "ProgrammeInvestment", entityId: investmentId, before: before as any, after: after as any },
      });
      return after;
    });
  }

  async list(programmeId: string) {
    const investments = await prisma.programmeInvestment.findMany({
      where: { programmeId },
      orderBy: { createdAt: "desc" },
      include: {
        counterparty: { select: { id: true, name: true } },
        placement: { select: { id: true, status: true } },
        income: { select: { amount: true } },
      },
    });
    return investments.map(({ income, ...i }) => ({ ...i, incomeTotal: income.reduce((t, x) => t.plus(x.amount), new Prisma.Decimal(0)).toFixed(2) }));
  }

  private async find(db: Prisma.TransactionClient | typeof prisma, programmeId: string, investmentId: string) {
    const investment = await db.programmeInvestment.findUnique({ where: { id: investmentId } });
    if (!investment || investment.programmeId !== programmeId) throw new NotFoundException(`Investment "${investmentId}" not found.`);
    return investment;
  }
}

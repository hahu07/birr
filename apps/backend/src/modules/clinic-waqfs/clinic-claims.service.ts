import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumberString, Matches, ValidateNested } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { DateField, IdField, TextField } from "../../common/validation/fields";
import { assertLicensesCurrent, lagosToday } from "../counterparties/counterparty-licenses.service";
import { ClinicLedgerService } from "./clinic-ledger.service";
import { ClinicPriceListsService } from "./clinic-price-lists.service";

type Db = Prisma.TransactionClient | typeof prisma;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_LINE_ERRORS = 20;

export class ClinicClaimLineInput {
  // The operator's own visit reference: never a name.
  @TextField(60)
  visitReference!: string;

  @DateField()
  visitDate!: string;

  @TextField(30)
  serviceCode!: string;

  @TextField(30)
  bandCode!: string;

  // What the patient paid; may be zero.
  @IsNumberString()
  patientPaid!: string;

  // The operator assessed the patient as poor or needy, so zakah pays.
  @IsBoolean()
  zakahEligible!: boolean;
}

export class CreateClinicClaimInput {
  // The month the visits were in, e.g. "2027-03".
  @TextField(7)
  @Matches(PERIOD, { message: "period must be a month like 2027-03." })
  period!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ClinicClaimLineInput)
  lines!: ClinicClaimLineInput[];
}

export class LinkClaimZakahInput {
  @IdField()
  zakahDistributionId!: string;
}

const naira = (amount: Prisma.Decimal | string) => `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const zero = () => new Prisma.Decimal(0);
const LIVE = ["submitted", "approved", "paid"] as const;
const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * A clinic waqf's operator and monthly claims (2026-11-17, clinic slice 7).
 *
 * - Operator: the Board assigns a licensed healthcare provider
 *   (clinic_waqf.operator_assign).
 * - Claims: a Mutawalli Officer uploads the operator's anonymous claim
 *   lines for a month. Each is checked against the approved price list:
 *   the service's price, and exactly the band's patient share. The
 *   subsidies split: lines for patients the operator assessed as poor or
 *   needy are the zakah part; the rest is the running fund part, which may
 *   not pass the list's monthly cap.
 * - The running fund part: the Board or Compliance approves
 *   (clinic_waqf.claim_approve), within the running fund's free cash; it's
 *   paid by bank transfer from the clinic waqf's account; Compliance or
 *   the Audit Committee confirms the bank reference
 *   (clinic_waqf.claim_mark_paid), which books it (5000 / 1100).
 * - The zakah part: paid through zakah's own two-person distribution to
 *   the operator (poor or needy, the exact amount), then linked here.
 */
@Injectable()
export class ClinicClaimsService {
  constructor(
    private readonly ledger: ClinicLedgerService,
    private readonly priceLists: ClinicPriceListsService,
  ) {}

  // ---- The operator: clinic_waqf.operator_assign (checker: the Board) ----

  private parseOperator(payload: unknown) {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (typeof p.programmeId !== "string") throw new BadRequestException("payload.programmeId is required.");
    if (typeof p.counterpartyId !== "string") throw new BadRequestException("payload.counterpartyId is required: the healthcare provider to assign.");
    return { programmeId: p.programmeId, counterpartyId: p.counterpartyId };
  }

  private async checkOperator(db: Db, payload: unknown) {
    const { programmeId, counterpartyId } = this.parseOperator(payload);
    const clinic = await db.waqfProgramme.findUnique({ where: { id: programmeId } });
    if (!clinic) throw new NotFoundException(`Clinic waqf "${programmeId}" not found.`);
    if (clinic.operatorId === counterpartyId) throw new BadRequestException("That provider already runs this clinic.");
    const provider = await db.counterparty.findUnique({ where: { id: counterpartyId } });
    if (!provider || provider.deletedAt) throw new NotFoundException("Counterparty not found.");
    if (provider.institutionType !== "healthcare_provider") throw new BadRequestException(`${provider.name} isn't a healthcare provider.`);
    if (provider.status !== "active") throw new BadRequestException(`${provider.name} isn't an active, vetted partner (status: ${provider.status}).`);
    await assertLicensesCurrent(db, provider.id);
    return { clinic, provider };
  }

  async validateOperatorProposal(payload: unknown) {
    await this.checkOperator(prisma, payload);
  }

  async checkDuplicateOperator(payload: unknown) {
    if (await this.pending("clinic_waqf.operator_assign", "programmeId", this.parseOperator(payload).programmeId)) {
      throw new ConflictException("An operator for this clinic is already waiting for the Board — check the Approvals queue.");
    }
  }

  async describeOperator(payload: unknown): Promise<string> {
    const { clinic, provider } = await this.checkOperator(prisma, payload);
    const current = clinic.operatorId ? await prisma.counterparty.findUnique({ where: { id: clinic.operatorId }, select: { name: true } }) : null;
    return `${provider.name} to run ${clinic.name}${current ? `, replacing ${current.name}` : ""}. Its monthly claims are paid from the running fund and zakah.`;
  }

  async currentOperatorState(payload: unknown): Promise<Record<string, unknown>> {
    const { programmeId, counterpartyId } = this.parseOperator(payload);
    const clinic = await prisma.waqfProgramme.findUniqueOrThrow({ where: { id: programmeId }, include: { operator: { select: { name: true } } } });
    const provider = await prisma.counterparty.findUniqueOrThrow({ where: { id: counterpartyId } });
    return { currentOperator: clinic.operator?.name ?? null, providerStatus: provider.status, providerType: provider.institutionType };
  }

  async assignOperator(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const { programmeId } = this.parseOperator(payload);
    await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${programmeId} FOR UPDATE`;
    const { clinic: before, provider } = await this.checkOperator(tx, payload);
    const after = await tx.waqfProgramme.update({
      where: { id: programmeId },
      data: { operatorId: provider.id, operatorActionId: governedActionId, operatorAssignedAt: new Date() },
    });
    return { before, after };
  }

  // ---- Claims ----

  async createClaim(programmeId: string, input: CreateClinicClaimInput, actorUserId: string) {
    if (!PERIOD.test(input.period)) throw new BadRequestException("period must be a month like 2027-03.");
    const today = lagosToday();
    if (input.period > today.slice(0, 7)) throw new BadRequestException("A claim can't be for a month that hasn't started.");

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${programmeId} FOR UPDATE`;
      const clinic = await tx.waqfProgramme.findUnique({ where: { id: programmeId } });
      if (!clinic) throw new NotFoundException(`Clinic waqf "${programmeId}" not found.`);
      if (clinic.status !== "established") throw new BadRequestException(`${clinic.name} isn't established yet.`);
      if (!clinic.operatorId) throw new BadRequestException("No operator has been assigned to this clinic yet.");
      const list = await this.priceLists.current(tx, programmeId);
      if (!list) throw new BadRequestException("This clinic has no approved price list to check claims against.");
      const live = await tx.clinicClaim.findFirst({ where: { programmeId, period: input.period, status: { in: [...LIVE] } } });
      if (live) throw new ConflictException(`There's already a ${live.status} claim for ${monthName(input.period)}. Discard it first to upload a corrected one.`);

      const services = new Map(list.content.services.map((s) => [s.code, s]));
      const bands = new Map(list.content.bands.map((b) => [b.code, b]));
      const errors: string[] = [];
      const seen = new Set<string>();
      const lines = input.lines.map((raw, i) => {
        const n = i + 1;
        const fail = (why: string) => {
          errors.push(`Line ${n}: ${why}`);
          return null;
        };
        const visitReference = raw.visitReference.trim();
        const serviceCode = raw.serviceCode.trim().toUpperCase();
        const bandCode = raw.bandCode.trim().toUpperCase();
        const key = `${visitReference}\u0000${serviceCode}`;
        if (seen.has(key)) return fail(`visit ${visitReference} claims ${serviceCode} twice.`);
        seen.add(key);
        if (!DAY.test(raw.visitDate)) return fail("the visit date must be a date like 2027-03-14.");
        if (raw.visitDate.slice(0, 7) !== input.period) return fail(`the visit (${raw.visitDate}) isn't in ${monthName(input.period)}.`);
        if (raw.visitDate > today) return fail(`the visit (${raw.visitDate}) is in the future.`);
        const service = services.get(serviceCode);
        if (!service) return fail(`${serviceCode} isn't on price list version ${list.version}.`);
        const band = bands.get(bandCode);
        if (!band) return fail(`band ${bandCode} isn't on price list version ${list.version}.`);
        const patientPaid = new Prisma.Decimal(raw.patientPaid);
        if (patientPaid.isNegative() || patientPaid.decimalPlaces() > 2) return fail("what the patient paid must be an amount in naira and kobo.");
        const price = new Prisma.Decimal(service.price);
        // Exactly the band's share: never more from the patient, never more from the fund.
        const share = price.times(band.patientSharePercent).dividedBy(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        if (!patientPaid.equals(share)) {
          return fail(`band ${bandCode} pays ${band.patientSharePercent}% of ${serviceCode}'s ${naira(price)}, which is ${naira(share)}, not ${naira(patientPaid)}.`);
        }
        return {
          visitReference,
          visitDate: new Date(`${raw.visitDate}T00:00:00Z`),
          serviceCode,
          bandCode,
          price,
          patientPaid,
          subsidy: price.minus(patientPaid),
          zakahEligible: raw.zakahEligible,
        };
      });

      // A visit's service is claimed once, ever: not again in a later month's claim.
      const already = await tx.clinicClaimLine.findMany({
        where: {
          programmeId,
          visitReference: { in: [...new Set(input.lines.map((l) => l.visitReference.trim()))] },
          claim: { status: { in: [...LIVE] } },
        },
        select: { visitReference: true, serviceCode: true, claim: { select: { period: true } } },
      });
      const claimed = new Map(already.map((l) => [`${l.visitReference}\u0000${l.serviceCode}`, l.claim.period]));
      lines.forEach((line, i) => {
        const period = line && claimed.get(`${line.visitReference}\u0000${line.serviceCode}`);
        if (period) errors.push(`Line ${i + 1}: visit ${line!.visitReference}'s ${line!.serviceCode} was already claimed for ${monthName(period)}.`);
      });

      if (errors.length > 0) {
        const more = errors.length > MAX_LINE_ERRORS ? ` …and ${errors.length - MAX_LINE_ERRORS} more.` : "";
        throw new BadRequestException(`${errors.length} line${errors.length === 1 ? "" : "s"} can't be accepted. ${errors.slice(0, MAX_LINE_ERRORS).join(" ")}${more}`);
      }

      const ok = lines as NonNullable<(typeof lines)[number]>[];
      const sum = (pick: (l: (typeof ok)[number]) => Prisma.Decimal, where: (l: (typeof ok)[number]) => boolean = () => true) =>
        ok.filter(where).reduce((t, l) => t.plus(pick(l)), zero());
      const totalPrice = sum((l) => l.price);
      const patientPaid = sum((l) => l.patientPaid);
      const subsidyTotal = sum((l) => l.subsidy);
      const zakahAmount = sum((l) => l.subsidy, (l) => l.zakahEligible);
      const runningFundAmount = subsidyTotal.minus(zakahAmount);
      const cap = new Prisma.Decimal(list.content.monthlySubsidyCap);
      if (runningFundAmount.gt(cap)) {
        throw new BadRequestException(`The running fund's part, ${naira(runningFundAmount)}, is over the monthly subsidy cap of ${naira(cap)}.`);
      }

      const claim = await tx.clinicClaim.create({
        data: {
          programmeId,
          period: input.period,
          operatorId: clinic.operatorId,
          priceListId: list.id,
          lineCount: ok.length,
          totalPrice,
          patientPaid,
          subsidyTotal,
          runningFundAmount,
          zakahAmount,
          createdByUserId: actorUserId,
        },
      });
      await tx.clinicClaimLine.createMany({ data: ok.map((l) => ({ ...l, claimId: claim.id, programmeId })) });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_claim.submitted", entityType: "ClinicClaim", entityId: claim.id, after: claim as any },
      });
      return claim;
    });
  }

  async discardClaim(programmeId: string, claimId: string, actorUserId: string) {
    if (await this.pending("clinic_waqf.claim_approve", "claimId", claimId)) {
      throw new ConflictException("This claim is waiting for approval. Have the proposal rejected first.");
    }
    return prisma.$transaction(async (tx) => {
      const before = await tx.clinicClaim.findUnique({ where: { id: claimId } });
      if (!before || before.programmeId !== programmeId) throw new NotFoundException(`Claim "${claimId}" not found.`);
      if (before.status !== "submitted") throw new BadRequestException(`This claim is ${before.status}; only a submitted one can be discarded.`);
      const after = await tx.clinicClaim.update({ where: { id: claimId }, data: { status: "discarded" } });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_claim.discarded", entityType: "ClinicClaim", entityId: claimId, before: before as any, after: after as any },
      });
      return after;
    });
  }

  listClaims(programmeId: string) {
    return prisma.clinicClaim.findMany({
      where: { programmeId },
      orderBy: [{ period: "desc" }, { createdAt: "desc" }],
      include: {
        operator: { select: { id: true, name: true } },
        priceList: { select: { version: true } },
        zakahDistribution: { select: { id: true, status: true, category: true } },
      },
    });
  }

  async claimLines(programmeId: string, claimId: string) {
    const claim = await prisma.clinicClaim.findUnique({ where: { id: claimId } });
    if (!claim || claim.programmeId !== programmeId) throw new NotFoundException(`Claim "${claimId}" not found.`);
    return prisma.clinicClaimLine.findMany({ where: { claimId }, orderBy: [{ visitDate: "asc" }, { visitReference: "asc" }, { serviceCode: "asc" }] });
  }

  /** What the running fund may still commit: its cash, less approved claims not yet paid. */
  private async runningHeadroom(db: Db, programmeId: string, excludeClaimId?: string) {
    const cash = await db.programmeJournalEntryLine.aggregate({
      where: { journalEntry: { programmeId, currency: "NGN" }, ledgerAccount: { code: "1100" } },
      _sum: { debit: true, credit: true },
    });
    const balance = (cash._sum.debit ?? zero()).minus(cash._sum.credit ?? 0);
    const committed = await db.clinicClaim.aggregate({
      where: { programmeId, status: "approved", ...(excludeClaimId && { id: { not: excludeClaimId } }) },
      _sum: { runningFundAmount: true },
    });
    return { balance, committed: committed._sum.runningFundAmount ?? zero() };
  }

  private async findClaim(id: unknown, db: Db = prisma) {
    if (typeof id !== "string") throw new BadRequestException("payload.claimId is required.");
    const claim = await db.clinicClaim.findUnique({
      where: { id },
      include: { operator: true, programme: { select: { name: true } }, priceList: { select: { version: true } } },
    });
    if (!claim) throw new NotFoundException(`Claim "${id}" not found.`);
    return claim;
  }

  private strip(claim: Awaited<ReturnType<ClinicClaimsService["findClaim"]>>) {
    const { operator: _o, programme: _c, priceList: _p, ...row } = claim;
    return row;
  }

  // ---- clinic_waqf.claim_approve (checkers: Board, Compliance) ----

  async validateClaimProposal(payload: unknown) {
    const c = await this.findClaim((payload as { claimId?: unknown })?.claimId);
    if (c.status !== "submitted") throw new BadRequestException(`This claim is already ${c.status}.`);
  }

  async checkDuplicateClaim(payload: unknown) {
    if (await this.pending("clinic_waqf.claim_approve", "claimId", (payload as { claimId: string }).claimId)) {
      throw new ConflictException("This claim is already waiting for approval — check the Approvals queue.");
    }
  }

  async describeClaim(payload: unknown): Promise<string> {
    const c = await this.findClaim((payload as { claimId: string }).claimId);
    return (
      `${c.operator.name}'s claim for ${monthName(c.period)} at ${c.programme.name}: ${c.lineCount} services at ${naira(c.totalPrice)} on price list ` +
      `version ${c.priceList.version}, patients paid ${naira(c.patientPaid)}, subsidies ${naira(c.subsidyTotal)}. ` +
      `Running fund: ${naira(c.runningFundAmount)}. Zakah, for patients assessed as poor or needy: ${naira(c.zakahAmount)}, paid separately through a zakah distribution.`
    );
  }

  async currentClaimState(payload: unknown): Promise<Record<string, unknown>> {
    const c = await this.findClaim((payload as { claimId: string }).claimId);
    const { balance, committed } = await this.runningHeadroom(prisma, c.programmeId, c.id);
    return { status: c.status, operatorStatus: c.operator.status, runningFundCash: balance.toFixed(2), runningFundCommittedToOtherClaims: committed.toFixed(2) };
  }

  async approveClaim(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const { claimId } = payload as { claimId: string };
    const found = await this.findClaim(claimId, tx);
    await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${found.programmeId} FOR UPDATE`;
    const before = await this.findClaim(claimId, tx);
    if (before.status !== "submitted") throw new BadRequestException(`This claim is already ${before.status}.`);
    if (before.operator.status !== "active" || before.operator.deletedAt) throw new BadRequestException(`${before.operator.name} is no longer an active, vetted partner.`);
    await assertLicensesCurrent(tx, before.operatorId);
    const { balance, committed } = await this.runningHeadroom(tx, before.programmeId, before.id);
    if (committed.plus(before.runningFundAmount).gt(balance)) {
      throw new BadRequestException(
        `The running fund has ${naira(balance.minus(committed))} free, less than this claim's ${naira(before.runningFundAmount)}. Wait for gifts or income to come in.`,
      );
    }
    const after = await tx.clinicClaim.update({ where: { id: claimId }, data: { status: "approved", approvalActionId: governedActionId, approvedAt: new Date() } });
    return { before: this.strip(before), after };
  }

  async rejectClaim(payload: unknown, tx: Prisma.TransactionClient) {
    const before = await tx.clinicClaim.findUnique({ where: { id: (payload as { claimId: string }).claimId } });
    if (!before || before.status !== "submitted") return null;
    return { before, after: await tx.clinicClaim.update({ where: { id: before.id }, data: { status: "rejected" } }) };
  }

  // ---- clinic_waqf.claim_mark_paid (checkers: Compliance, Audit Committee) ----

  private parsePaid(payload: unknown) {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (typeof p.claimId !== "string") throw new BadRequestException("payload.claimId is required.");
    const bankReference = typeof p.bankReference === "string" ? p.bankReference.trim() : "";
    if (bankReference.length < 3 || bankReference.length > 100) throw new BadRequestException("payload.bankReference must be the bank's reference for the transfer.");
    if (typeof p.paidOn !== "string" || !DAY.test(p.paidOn)) throw new BadRequestException('payload.paidOn must be a date like "2027-02-12".');
    if (p.paidOn > lagosToday()) throw new BadRequestException(`payload.paidOn (${p.paidOn}) is in the future.`);
    return { claimId: p.claimId, bankReference, paidOn: p.paidOn };
  }

  async validatePaidProposal(payload: unknown) {
    const p = this.parsePaid(payload);
    const c = await this.findClaim(p.claimId);
    if (c.status !== "approved") throw new BadRequestException(`Only an approved claim can be marked paid (this one is ${c.status}).`);
    if (c.runningFundAmount.isZero()) throw new BadRequestException("This claim has nothing to pay from the running fund; its zakah part is paid through a zakah distribution.");
    if (c.approvedAt && p.paidOn < c.approvedAt.toISOString().slice(0, 10)) throw new BadRequestException("The payment date is before the claim was approved.");
  }

  async checkDuplicatePaid(payload: unknown) {
    if (await this.pending("clinic_waqf.claim_mark_paid", "claimId", (payload as { claimId: string }).claimId)) {
      throw new ConflictException("This claim's payment is already waiting for confirmation.");
    }
  }

  async describePaid(payload: unknown): Promise<string> {
    const p = this.parsePaid(payload);
    const c = await this.findClaim(p.claimId);
    return `Paid ${naira(c.runningFundAmount)} to ${c.operator.name} from ${c.programme.name}'s account on ${p.paidOn} for ${monthName(c.period)}'s claim, bank reference ${p.bankReference}. Check it against the bank statement before confirming.`;
  }

  /** Books the running fund part (5000 Subsidised visits / 1100). Locks the clinic row first; the engine audits after. */
  async markPaid(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const p = this.parsePaid(payload);
    const found = await this.findClaim(p.claimId, tx);
    await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${found.programmeId} FOR UPDATE`;
    const before = await this.findClaim(p.claimId, tx);
    if (before.status !== "approved") throw new BadRequestException(`Only an approved claim can be marked paid (this one is ${before.status}).`);
    const after = await tx.clinicClaim.update({
      where: { id: p.claimId },
      data: { status: "paid", paymentActionId: governedActionId, paidOn: new Date(`${p.paidOn}T00:00:00Z`), bankReference: p.bankReference },
    });
    await this.ledger.post(tx, {
      programmeId: before.programmeId,
      description: `${monthName(before.period)} claim from ${before.operator.name}: subsidised visits`,
      currency: "NGN",
      source: "claim_paid",
      sourceId: before.id,
      actorType: "system",
      lines: [
        { accountCode: "5000", debit: before.runningFundAmount },
        { accountCode: "1100", credit: before.runningFundAmount },
      ],
    });
    return { before: this.strip(before), after };
  }

  // ---- The zakah part ----

  /**
   * Links the zakah distribution that pays a claim's zakah part: to the
   * claim's operator, from zakah on wealth, for the poor or the needy, for
   * exactly the zakah part. Zakah's own two-person approval and payment
   * confirmation apply to it as to any distribution.
   */
  async linkZakah(programmeId: string, claimId: string, input: LinkClaimZakahInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "clinic_claims" WHERE "id" = ${claimId} FOR UPDATE`;
      const before = await tx.clinicClaim.findUnique({ where: { id: claimId } });
      if (!before || before.programmeId !== programmeId) throw new NotFoundException(`Claim "${claimId}" not found.`);
      if (before.status !== "approved" && before.status !== "paid") throw new BadRequestException("Only an approved claim's zakah part is paid.");
      if (before.zakahAmount.isZero()) throw new BadRequestException("This claim has no zakah part.");
      if (before.zakahDistributionId) throw new ConflictException("This claim's zakah part is already linked to a distribution.");
      const distribution = await tx.zakahDistribution.findUnique({ where: { id: input.zakahDistributionId }, include: { clinicClaim: { select: { id: true } } } });
      if (!distribution) throw new NotFoundException("Zakah distribution not found.");
      if (distribution.clinicClaim) throw new ConflictException("That zakah distribution already pays another claim.");
      if (distribution.status === "rejected") throw new BadRequestException("That zakah distribution was rejected.");
      if (distribution.counterpartyId !== before.operatorId) throw new BadRequestException("The zakah distribution must be to this claim's operator.");
      if (distribution.pool !== "mal") throw new BadRequestException("A clinic bill is paid from zakah on wealth, not Zakah al-Fitr.");
      if (distribution.category !== "fuqara" && distribution.category !== "masakin") throw new BadRequestException("A clinic bill is paid to the poor or the needy only.");
      if (distribution.currency !== "NGN" || !distribution.amount.equals(before.zakahAmount)) {
        throw new BadRequestException(`The zakah distribution must be for exactly the claim's zakah part, ${naira(before.zakahAmount)}.`);
      }
      const after = await tx.clinicClaim.update({ where: { id: claimId }, data: { zakahDistributionId: distribution.id } });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "clinic_claim.zakah_linked", entityType: "ClinicClaim", entityId: claimId, before: before as any, after: after as any },
      });
      return after;
    });
  }

  private pending(permissionKey: string, field: string, value: string) {
    return prisma.governedAction.findFirst({
      where: { status: "proposed", permission: { key: permissionKey }, payload: { path: [field], equals: value } },
    });
  }
}

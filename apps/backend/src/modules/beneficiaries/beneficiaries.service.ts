import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { IsDateString, IsEmail, IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { prisma, Prisma, BeneficiaryStatus, BeneficiaryKind, PayoutProvider } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { EncryptionService } from "../../common/settings/encryption.service";
import type { PayoutBankDetails } from "../distributions/providers/payout-provider.interface";

// See list()'s own 2026-09-14 comment below — bounds the two
// waqfId-omitted "see everything" branches, which otherwise returned
// every beneficiary's decrypted bank details platform-wide in one call.
// Exported so its own regression test doesn't hardcode a second copy of
// this number.
export const MAX_UNSCOPED_LIST_ROWS = 200;

// bankCode stays optional here — a beneficiary's partial bank details
// (or a beneficiary not yet meant for Paystack payout at all) can still
// be saved. It only becomes a hard requirement at distribution-approval
// time, via DistributionsService.assertPayoutReady ->
// getDecryptedBankDetailsForPayout below — same "required going
// forward, enforced downstream, not at this DTO" posture as this file's
// own causeId convention.
export class BankDetailsInput {
  @IsString()
  bankName!: string;

  @IsString()
  accountNumber!: string;

  @IsString()
  accountName!: string;

  @IsOptional()
  @IsString()
  bankCode?: string;
}

export class CreateBeneficiaryInput {
  @IsString()
  waqfId!: string;

  // Required going forward — the DB column itself stays nullable (no
  // backfill for pre-existing rows, same convention as
  // Investment.counterpartyId), so this is an input-layer requirement,
  // not a schema one.
  @IsString()
  causeId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(BeneficiaryKind)
  kind?: BeneficiaryKind;

  @IsString()
  eligibilityCriteria!: string;

  // Deliberately not @IsPhoneNumber()/@IsEmail() strict-shape validation
  // on phone — an organization's contact info doesn't always fit a
  // personal-phone shape, and staff verify this by hand regardless.
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BankDetailsInput)
  bankDetails?: BankDetailsInput;

  // Which outbound-payout rail pays this beneficiary — see
  // PayoutProvider's own schema comment on why only "paystack" actually
  // pays out today. Optional at creation for the same reason bankCode
  // is: enforced as a hard requirement only at distribution-approval
  // time (DistributionsService.assertPayoutReady).
  @IsOptional()
  @IsEnum(PayoutProvider)
  payoutProvider?: PayoutProvider;

  @IsOptional()
  @IsDateString()
  eligibilityExpiresAt?: string;
}

// Registering payout details after a beneficiary already exists — the
// only way to make an already-registered beneficiary payout-ready,
// since bankDetails/payoutProvider on CreateBeneficiaryInput are both
// optional (a beneficiary can be registered before their bank details
// are known). Both required here: this route exists specifically to
// set them, not to leave either half missing.
export class SetPayoutDetailsInput {
  @IsEnum(PayoutProvider)
  payoutProvider!: PayoutProvider;

  @ValidateNested()
  @Type(() => BankDetailsInput)
  bankDetails!: BankDetailsInput;
}

@Injectable()
export class BeneficiariesService {
  constructor(private readonly encryption: EncryptionService) {}

  private packBankDetails(details?: BankDetailsInput): string | undefined {
    return details ? this.encryption.encrypt(JSON.stringify(details)) : undefined;
  }

  private unpackBankDetails(encrypted: string | null): BankDetailsInput | null {
    return encrypted ? JSON.parse(this.encryption.decrypt(encrypted)) : null;
  }

  // Staff-facing display only — decrypts bankDetailsEncrypted into a
  // plain bankDetails object and drops the ciphertext field from the
  // response. Public (not applied automatically inside findById()/list()
  // below) and called explicitly by BeneficiariesController's two
  // HTTP-facing read routes — internal callers like
  // GovernedActionsService.resolveWaqfId only need a raw row's waqfId
  // and shouldn't pay for (or risk failing on) a decrypt they never
  // asked for. Never applied on summaryForFounder's path (already
  // PII-free).
  withDecryptedBankDetails<T extends { bankDetailsEncrypted: string | null }>(row: T) {
    const { bankDetailsEncrypted, ...rest } = row;
    return { ...rest, bankDetails: this.unpackBankDetails(bankDetailsEncrypted) };
  }

  /**
   * causeId is required (see CreateBeneficiaryInput's own comment). When
   * given, it must belong to the same waqf as the beneficiary itself —
   * Postgres can't express that as a composite FK here, so it's checked
   * in application code instead (mirrors DistributionsService.create()'s
   * identical check).
   *
   * Not maker-checker gated (only beneficiary.criteria_update and
   * beneficiary.status_change are), but still a create on a governed
   * entity per CLAUDE.md's audit-trail non-negotiable — wrapped in a
   * transaction so the create and its audit row are atomic.
   */
  async create(input: CreateBeneficiaryInput, actorUserId: string) {
    const cause = await prisma.waqfCause.findUnique({ where: { id: input.causeId } });
    if (!cause || cause.waqfId !== input.waqfId) {
      throw new BadRequestException(`Cause "${input.causeId}" does not belong to waqf "${input.waqfId}".`);
    }

    return prisma.$transaction(async (tx) => {
      const { bankDetails, eligibilityExpiresAt, ...rest } = input;
      const beneficiary = await tx.beneficiary.create({
        data: {
          ...rest,
          bankDetailsEncrypted: this.packBankDetails(bankDetails),
          eligibilityExpiresAt: eligibilityExpiresAt ? new Date(eligibilityExpiresAt) : undefined,
        },
      });
      // bankDetailsEncrypted deliberately excluded from the audit
      // snapshot — audit_logs has no access restriction beyond the
      // DB-role revoke CLAUDE.md already mandates, and a ciphertext
      // blob sitting there is needless exposure surface even encrypted.
      const { bankDetailsEncrypted: _bankDetailsEncrypted, ...auditSafe } = beneficiary;
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "beneficiary.created",
          entityType: "Beneficiary",
          entityId: beneficiary.id,
          after: auditSafe as any,
        },
      });
      return beneficiary;
    });
  }

  /**
   * Plain staff CRUD, not maker-checker gated — same posture as create()
   * itself (bank details are already settable, ungoverned, at creation
   * time; updating them afterward is the same kind of action, not a new
   * fiduciary decision). Registering payout details doesn't move money
   * by itself — DistributionsService.assertPayoutReady is still what
   * gates whether a distribution to this beneficiary can actually be
   * approved. Exists because CreateBeneficiaryInput's bankDetails/
   * payoutProvider are both optional (a beneficiary can be registered
   * before their bank details are known) — without this, an
   * already-registered beneficiary would have no way to ever become
   * payout-ready.
   */
  async setPayoutDetails(id: string, input: SetPayoutDetailsInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.beneficiary.findUnique({ where: { id } });
      if (!before) throw new NotFoundException(`Beneficiary "${id}" not found.`);
      const updated = await tx.beneficiary.update({
        where: { id },
        data: {
          payoutProvider: input.payoutProvider,
          bankDetailsEncrypted: this.packBankDetails(input.bankDetails),
        },
      });
      // bankDetailsEncrypted excluded from both audit snapshots — same
      // reasoning as create()'s identical exclusion.
      const { bankDetailsEncrypted: _before, ...beforeSafe } = before;
      const { bankDetailsEncrypted: _after, ...afterSafe } = updated;
      await tx.auditLog.create({
        data: {
          waqfId: updated.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "beneficiary.payout_details_set",
          entityType: "Beneficiary",
          entityId: updated.id,
          before: beforeSafe as any,
          after: afterSafe as any,
        },
      });
      return updated;
    });
  }

  /**
   * Internal only — never expose this behind a public controller route.
   * beneficiary.criteria_update is a governed action (see schema.prisma's
   * comment on Beneficiary); the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction.
   */
  async updateCriteria(id: string, newCriteria: string, tx: Prisma.TransactionClient) {
    const beneficiary = await tx.beneficiary.findUnique({ where: { id } });
    if (!beneficiary) throw new NotFoundException(`Beneficiary "${id}" not found.`);
    return tx.beneficiary.update({
      where: { id },
      data: { eligibilityCriteria: newCriteria },
    });
  }

  /**
   * Internal only — never expose behind a public controller route.
   * beneficiary.status_change is a governed action; the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction. This is what makes the status field mean something —
   * see DistributionsService.assertBeneficiaryEligible, the other half
   * of that: without it, disabling someone here had no real effect on
   * whether a distribution could still be created against them.
   */
  async updateStatus(id: string, newStatus: BeneficiaryStatus, tx: Prisma.TransactionClient) {
    const beneficiary = await tx.beneficiary.findUnique({ where: { id } });
    if (!beneficiary) throw new NotFoundException(`Beneficiary "${id}" not found.`);
    return tx.beneficiary.update({ where: { id }, data: { status: newStatus } });
  }

  /**
   * Internal only — never expose behind a public controller route. The
   * only caller is DistributionsService (assertPayoutReady, which just
   * needs this not to throw, and initiateDisbursement, which needs the
   * actual decrypted values). Serves as both the payout-readiness check
   * and the decrypted-details fetch — one place owns the shape
   * requirement instead of two call sites separately deciding what
   * "complete" means. Throws BadRequestException (not a bare null) if
   * bank details or a bank code are missing, since every caller treats
   * incompleteness as fatal.
   */
  async getDecryptedBankDetailsForPayout(
    beneficiaryId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<PayoutBankDetails> {
    const beneficiary = await client.beneficiary.findUnique({ where: { id: beneficiaryId } });
    if (!beneficiary) throw new NotFoundException(`Beneficiary "${beneficiaryId}" not found.`);
    if (!beneficiary.bankDetailsEncrypted) {
      throw new BadRequestException(`Beneficiary "${beneficiary.name}" has no bank details on file.`);
    }
    const details = this.unpackBankDetails(beneficiary.bankDetailsEncrypted)!;
    if (!details.bankCode) {
      throw new BadRequestException(`Beneficiary "${beneficiary.name}"'s bank details are missing a bank code.`);
    }
    return details as PayoutBankDetails;
  }

  // Raw — bankDetailsEncrypted stays as ciphertext. Internal callers
  // (e.g. GovernedActionsService.resolveWaqfId, which only needs
  // .waqfId) use this directly, unguarded — trusted internal fulfillment
  // code, not an HTTP-facing PII read. BeneficiariesController's HTTP
  // -facing routes call assertStaffCanAccessWaqf() themselves before
  // calling this, then withDecryptedBankDetails() on top for display —
  // see those methods' own comments.
  findById(id: string) {
    return prisma.beneficiary.findUnique({ where: { id } });
  }

  // 2026-09-08 audit fix: any authenticated Birr staff member, regardless
  // of role or caseload, could previously pull any beneficiary's decrypted
  // bank details — no segregation-of-duties check existed at all on this
  // read path. platform_admin is the one bootstrap/emergency-access
  // exemption; every other role needs an active WaqfCaseAssignment on the
  // waqf in question. Deliberately not extending this exemption to
  // audit_committee/external_auditor/etc. — the audit finding used those
  // roles as its example of the *problem*, and granting them a blanket
  // bypass instead of scoping them to their actual caseload would be a
  // policy call, not something to infer from the finding itself.
  async assertStaffCanAccessWaqf(waqfId: string, staff: { id: string; staffRole: string }): Promise<void> {
    if (staff.staffRole === "platform_admin") return;
    const assignment = await prisma.waqfCaseAssignment.findFirst({
      where: { waqfId, birrStaffId: staff.id, status: "active" },
      select: { id: true },
    });
    if (!assignment) {
      throw new ForbiddenException(
        "You don't have an active case assignment for this waqf — beneficiary details are scoped to assigned staff.",
      );
    }
  }

  // waqfId given: caller (BeneficiariesController) has already asserted
  // access via assertStaffCanAccessWaqf. waqfId omitted: rather than the
  // previous firm-wide dump, scope to the caller's own active caseload —
  // platform_admin keeps seeing everything, matching its role as the one
  // exemption above.
  //
  // Update, 2026-09-14 — both waqfId-omitted branches are capped at
  // MAX_UNSCOPED_LIST_ROWS: found live during a comprehensive Founder-side
  // review that this endpoint's controller (BeneficiariesController.list())
  // calls withDecryptedBankDetails() on every returned row, so an
  // unfiltered call was returning every beneficiary's decrypted bank
  // account details, platform-wide, in one unbounded response — real
  // financial PII, not just a scale concern. No caller in this codebase
  // today omits waqfId (the Ops UI always scopes to one waqf), so this
  // cap has no effect on any known usage; it exists purely to bound the
  // blast radius of the platform_admin/caseload "see everything" paths
  // this method deliberately still offers. Same `take`-cap convention as
  // WaqfsService.list()'s own capped branch — this codebase has no
  // cursor-pagination primitive yet, so a hard cap is the established
  // pattern, not a partial fix.
  list(waqfId: string | undefined, staff: { id: string; staffRole: string }) {
    if (waqfId) {
      return prisma.beneficiary.findMany({ where: { waqfId }, orderBy: { createdAt: "desc" } });
    }
    if (staff.staffRole === "platform_admin") {
      return prisma.beneficiary.findMany({ orderBy: { createdAt: "desc" }, take: MAX_UNSCOPED_LIST_ROWS });
    }
    return prisma.beneficiary.findMany({
      where: { waqf: { caseAssignments: { some: { birrStaffId: staff.id, status: "active" } } } },
      orderBy: { createdAt: "desc" },
      take: MAX_UNSCOPED_LIST_ROWS,
    });
  }

  // Founder-Portal read-only visibility into their own waqf's
  // beneficiaries. Originally an aggregate only — no individual rows —
  // on the reasoning that Beneficiary.name/eligibilityCriteria/phone/
  // email are real personal information about who receives a payout,
  // and standard endowment practice keeps that confidential from the
  // donor, not just the general public. Reversed at the owner's
  // explicit, informed decision on 2026-09-29, after that privacy
  // tradeoff was raised directly: `beneficiaries` below now also
  // returns each one's name/kind/eligibilityCriteria/status/phone/
  // email/cause — everything except bank/payout details
  // (bankDetailsEncrypted, payoutProvider), which stay staff-only
  // regardless, same as every other Founder Portal surface that ever
  // touches money-routing information. byStatus/byCause are kept
  // alongside the full list, not replaced by it — still what the
  // summary StatCards above the list read from. Same
  // null-means-not-found-or-not-theirs convention as
  // AssetsService.listForFounder.
  async summaryForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) return null;

      const beneficiaries = await tx.beneficiary.findMany({
        where: { waqfId, deletedAt: null },
        select: {
          id: true,
          name: true,
          kind: true,
          eligibilityCriteria: true,
          status: true,
          phone: true,
          email: true,
          causeId: true,
          cause: { select: { name: true } },
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      const byStatus: Record<BeneficiaryStatus, number> = { active: 0, inactive: 0 };
      const countByCauseId = new Map<string, number>();
      for (const b of beneficiaries) {
        byStatus[b.status] += 1;
        if (b.causeId) countByCauseId.set(b.causeId, (countByCauseId.get(b.causeId) ?? 0) + 1);
      }

      const causes =
        countByCauseId.size > 0
          ? await tx.waqfCause.findMany({ where: { id: { in: [...countByCauseId.keys()] } } })
          : [];
      const causeById = new Map(causes.map((c) => [c.id, c]));

      return {
        total: beneficiaries.length,
        byStatus,
        byCause: [...countByCauseId.entries()].map(([causeId, count]) => ({
          causeId,
          causeName: causeById.get(causeId)?.name ?? "Unknown cause",
          count,
        })),
        beneficiaries: beneficiaries.map((b) => ({
          id: b.id,
          name: b.name,
          kind: b.kind,
          eligibilityCriteria: b.eligibilityCriteria,
          status: b.status,
          phone: b.phone,
          email: b.email,
          causeName: b.cause?.name ?? null,
          createdAt: b.createdAt,
        })),
      };
    });
  }

  /**
   * Backend-computed, PII-free duplicate detection — built for
   * AiAgentsService.beneficiaryVerificationData() (Munsif's own read
   * tool). Loads phone/email transiently to compute matches, but never
   * returns either value; only ids and which other ids they match.
   * Platform-wide (a duplicate attempt is exactly as likely across two
   * different waqfs as within one) and includes pending
   * BeneficiaryNominations too, so a duplicate is caught before
   * approval, not just after — an approved/rejected nomination is
   * excluded, same as any other already-resolved case.
   *
   * Normalization is deliberately simple (strip non-digits from phone,
   * lowercase+trim email) — a real first pass, not full phone-number
   * canonicalization (e.g. a local "0800..." and its "+234800..."
   * country-code form won't match each other). Extending to a real
   * phone-parsing library is real, flagged follow-on work if this
   * simple pass proves too noisy/too quiet in practice.
   */
  async findPossibleDuplicates(): Promise<
    { id: string; type: "beneficiary" | "nomination"; matchedWith: { id: string; type: "beneficiary" | "nomination" }[] }[]
  > {
    interface MatchCandidate {
      id: string;
      type: "beneficiary" | "nomination";
      phone: string | null;
      email: string | null;
    }

    const [beneficiaries, nominations] = await Promise.all([
      prisma.beneficiary.findMany({ where: { deletedAt: null }, select: { id: true, phone: true, email: true } }),
      prisma.beneficiaryNomination.findMany({ where: { status: "pending" }, select: { id: true, phone: true, email: true } }),
    ]);

    const candidates: MatchCandidate[] = [
      ...beneficiaries.map((b) => ({ id: b.id, type: "beneficiary" as const, phone: b.phone, email: b.email })),
      ...nominations.map((n) => ({ id: n.id, type: "nomination" as const, phone: n.phone, email: n.email })),
    ];

    const key = (c: MatchCandidate) => `${c.type}:${c.id}`;
    const normalizePhone = (phone: string | null) => (phone ? phone.replace(/\D/g, "") : null);
    const normalizeEmail = (email: string | null) => (email ? email.trim().toLowerCase() : null);

    const byPhone = new Map<string, MatchCandidate[]>();
    const byEmail = new Map<string, MatchCandidate[]>();
    for (const c of candidates) {
      const phone = normalizePhone(c.phone);
      const email = normalizeEmail(c.email);
      if (phone) {
        if (!byPhone.has(phone)) byPhone.set(phone, []);
        byPhone.get(phone)!.push(c);
      }
      if (email) {
        if (!byEmail.has(email)) byEmail.set(email, []);
        byEmail.get(email)!.push(c);
      }
    }

    const matchedKeysById = new Map<string, Set<string>>();
    const recordGroup = (group: MatchCandidate[]) => {
      if (group.length < 2) return;
      for (const a of group) {
        for (const b of group) {
          if (a === b) continue;
          if (!matchedKeysById.has(key(a))) matchedKeysById.set(key(a), new Set());
          matchedKeysById.get(key(a))!.add(key(b));
        }
      }
    };
    for (const group of byPhone.values()) recordGroup(group);
    for (const group of byEmail.values()) recordGroup(group);

    const candidateByKey = new Map(candidates.map((c) => [key(c), c]));
    return [...matchedKeysById.entries()].map(([k, matchedKeys]) => {
      const candidate = candidateByKey.get(k)!;
      return {
        id: candidate.id,
        type: candidate.type,
        matchedWith: [...matchedKeys].map((mk) => {
          const m = candidateByKey.get(mk)!;
          return { id: m.id, type: m.type };
        }),
      };
    });
  }

  /**
   * Same two conditions DistributionsService.assertBeneficiaryEligible
   * enforces at distribution create/approve time (status, expiry) —
   * surfaced here as a standalone, proactive read so a stale/expired
   * eligibility can be caught before anyone attempts a distribution,
   * not just discovered as a rejection afterward. Deliberately excludes
   * that method's third condition (causeId mismatch against a specific
   * distribution's own causeId) — that's only meaningful relative to an
   * actual attempted distribution, not a standalone eligibility read.
   */
  async listEligibilityIssues(): Promise<{ beneficiaryId: string; waqfId: string; issues: string[] }[]> {
    const active = await prisma.beneficiary.findMany({
      where: { deletedAt: null },
      select: { id: true, waqfId: true, status: true, eligibilityExpiresAt: true },
    });
    return active
      .map((b) => {
        const issues: string[] = [];
        if (b.status !== "active") issues.push("inactive");
        if (b.eligibilityExpiresAt && b.eligibilityExpiresAt < new Date()) issues.push("eligibility_expired");
        return { beneficiaryId: b.id, waqfId: b.waqfId, issues };
      })
      .filter((b) => b.issues.length > 0);
  }
}

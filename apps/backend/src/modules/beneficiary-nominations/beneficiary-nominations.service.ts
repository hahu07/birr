import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { prisma, Prisma, BeneficiaryKind, PayoutProvider } from "@birr/db";
import { NotificationsService } from "../notifications/notifications.service";
import { BankDetailsInput } from "../beneficiaries/beneficiaries.service";
import { EncryptionService } from "../../common/settings/encryption.service";

const NAME_MAX_LENGTH = 200;
const ELIGIBILITY_MAX_LENGTH = 1000;
const REVIEW_NOTES_MAX_LENGTH = 500;

export class ProposeBeneficiaryNominationInput {
  @IsString()
  waqfId!: string;

  // Required going forward — see Beneficiary.causeId's own comment on
  // why the DB column itself stays nullable.
  @IsString()
  causeId!: string;

  @IsString()
  @IsNotEmpty({ message: "Name is required." })
  @MaxLength(NAME_MAX_LENGTH)
  name!: string;

  @IsOptional()
  @IsEnum(BeneficiaryKind)
  kind?: BeneficiaryKind;

  @IsString()
  @IsNotEmpty({ message: "Eligibility is required." })
  @MaxLength(ELIGIBILITY_MAX_LENGTH)
  eligibilityCriteria!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // A Founder can include these in the nomination itself (confirmed
  // with the user) — carried straight through to the resulting
  // Beneficiary on approval, still encrypted the same way, still never
  // decrypted back for Founder display (see listForFounder's own
  // comment below).
  @IsOptional()
  @ValidateNested()
  @Type(() => BankDetailsInput)
  bankDetails?: BankDetailsInput;

  // Same reasoning as bankDetails above — carried through to the
  // resulting Beneficiary on approval, see Beneficiary.payoutProvider's
  // own schema comment.
  @IsOptional()
  @IsEnum(PayoutProvider)
  payoutProvider?: PayoutProvider;
}

export class RejectBeneficiaryNominationInput {
  @IsString()
  @IsNotEmpty({ message: "A reason is required when rejecting a nomination." })
  @MaxLength(REVIEW_NOTES_MAX_LENGTH)
  reviewNotes!: string;
}

const NOMINATION_INCLUDE = {
  proposedByFounder: { select: { id: true, name: true } },
  proposedByUser: { select: { id: true, fullName: true } },
  cause: { select: { id: true, name: true } },
  reviewedByUser: { select: { id: true, fullName: true } },
  resultingBeneficiary: { select: { id: true, name: true } },
} as const;

@Injectable()
export class BeneficiaryNominationsService {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly encryption: EncryptionService,
  ) {}

  private packBankDetails(details?: BankDetailsInput): string | undefined {
    return details ? this.encryption.encrypt(JSON.stringify(details)) : undefined;
  }

  /**
   * Founder-Portal self-service — proposing someone for this waqf's
   * beneficiary list. Deliberately NOT immediate registration (unlike
   * WaqfCausesService.allocate's self-service posture): a Founder
   * naming their own beneficiaries directly would remove Birr's
   * independent eligibility check as trustee and risk self-dealing —
   * see BeneficiariesService.summaryForFounder's own comment on why
   * beneficiary identity is kept confidential from the donor in the
   * first place. Plain CRUD, not governed_actions — same "organizational
   * metadata, not itself a fiduciary act" reasoning already established
   * for CauseCategorySuggestion, which this mirrors closely.
   */
  async propose(input: ProposeBeneficiaryNominationInput, founderId: string, userId: string) {
    const waqf = await prisma.waqf.findFirst({
      where: { id: input.waqfId, foundation: { foundationFounders: { some: { founderId } } } },
    });
    if (!waqf) throw new BadRequestException(`Waqf "${input.waqfId}" does not belong to you.`);

    const cause = await prisma.waqfCause.findUnique({ where: { id: input.causeId } });
    if (!cause || cause.waqfId !== input.waqfId) {
      throw new BadRequestException(`Cause "${input.causeId}" does not belong to waqf "${input.waqfId}".`);
    }

    const nomination = await prisma.$transaction(async (tx) => {
      const { bankDetails, ...rest } = input;
      const nomination = await tx.beneficiaryNomination.create({
        data: {
          ...rest,
          proposedByFounderId: founderId,
          proposedByUserId: userId,
          name: input.name.trim(),
          eligibilityCriteria: input.eligibilityCriteria.trim(),
          bankDetailsEncrypted: this.packBankDetails(bankDetails),
        },
      });
      // bankDetailsEncrypted excluded from the audit snapshot — same
      // reasoning as BeneficiariesService.create's identical exclusion.
      const { bankDetailsEncrypted, ...auditSafe } = nomination;
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "founder_user",
          actorUserId: userId,
          actorFounderId: founderId,
          action: "beneficiary_nomination.proposed",
          entityType: "BeneficiaryNomination",
          entityId: nomination.id,
          after: auditSafe as any,
        },
      });
      return nomination;
    });

    this.notifyCaseAssignees(nomination.waqfId, nomination.id, nomination.name).catch((err) => {
      console.error(`Failed to notify case assignees of new beneficiary nomination "${nomination.id}":`, err);
    });

    return nomination;
  }

  /**
   * Beneficiary registration (BeneficiariesController.create()) has no
   * role restriction beyond an authenticated staff session — unlike
   * CauseCategoriesController's platform_admin-only create, which is
   * why CauseCategorySuggestionsService notifies platform admins
   * specifically. There's no single role that "owns" beneficiary review
   * here, so the closer fit is staff actually assigned to this waqf's
   * caseload (CLAUDE.md's own concept) — any assignmentRole, active
   * only. Direct query, same posture as the precedent's own direct
   * prisma.birrStaff.findMany — not worth a cross-module dependency on
   * WaqfCaseAssignmentsService for one lookup.
   */
  private async notifyCaseAssignees(waqfId: string, nominationId: string, name: string): Promise<void> {
    const assignees = await prisma.waqfCaseAssignment.findMany({
      where: { waqfId, status: "active" },
      select: { birrStaff: { select: { userId: true } } },
    });
    await Promise.all(
      assignees.map((a) =>
        this.notificationsService.notify({
          recipientType: "birr_staff",
          recipientUserId: a.birrStaff.userId,
          type: "beneficiary_nomination.pending",
          title: "New beneficiary nomination pending review",
          body: `A founder proposed a beneficiary: "${name}".`,
          linkUrl: `/ops/waqfs/${waqfId}`,
          relatedEntityType: "BeneficiaryNomination",
          relatedEntityId: nominationId,
        }),
      ),
    );
  }

  /**
   * No @RequiresStaffRole on the controller route calling this —
   * deliberate divergence from CauseCategorySuggestionsService.approve(),
   * which is platform_admin-only because it performs the same
   * authority-level write as CauseCategoriesController's own create.
   * Approving a nomination performs the same write
   * BeneficiariesController.create() already does, and that route
   * carries no role restriction — so this shouldn't invent one either.
   * A Beneficiary needs nothing beyond what the nomination already
   * carries (name, eligibilityCriteria, causeId) — unlike the
   * precedent's approval, which adds icon/sortOrder/typicalWaqfTypes
   * staff-side.
   */
  async approve(id: string, reviewerUserId: string) {
    const reviewed = await prisma.$transaction(async (tx) => {
      const nomination = await this.loadPending(tx, id);

      const beneficiary = await tx.beneficiary.create({
        data: {
          waqfId: nomination.waqfId,
          causeId: nomination.causeId,
          name: nomination.name,
          kind: nomination.kind,
          eligibilityCriteria: nomination.eligibilityCriteria,
          phone: nomination.phone,
          email: nomination.email,
          // Already encrypted (see propose()'s own packBankDetails call)
          // — carried through verbatim, never decrypted/re-encrypted
          // here.
          bankDetailsEncrypted: nomination.bankDetailsEncrypted,
          payoutProvider: nomination.payoutProvider,
        },
      });

      const reviewed = await tx.beneficiaryNomination.update({
        where: { id },
        data: {
          status: "approved",
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
          resultingBeneficiaryId: beneficiary.id,
        },
      });

      // bankDetailsEncrypted excluded from both audit rows below — same
      // reasoning as BeneficiariesService.create's identical exclusion.
      const { bankDetailsEncrypted: _nominationBankDetails, ...nominationAuditSafe } = nomination;
      const { bankDetailsEncrypted: _reviewedBankDetails, ...reviewedAuditSafe } = reviewed;
      await tx.auditLog.create({
        data: {
          waqfId: nomination.waqfId,
          actorType: "birr_staff",
          actorUserId: reviewerUserId,
          action: "beneficiary_nomination.approved",
          entityType: "BeneficiaryNomination",
          entityId: id,
          before: nominationAuditSafe as any,
          after: reviewedAuditSafe as any,
        },
      });
      // Indistinguishable in the audit trail from a beneficiary staff
      // typed in directly — same reasoning as CauseCategorySuggestionsService
      // .approve()'s own resulting-CauseCategory audit row.
      const { bankDetailsEncrypted: _beneficiaryBankDetails, ...beneficiaryAuditSafe } = beneficiary;
      await tx.auditLog.create({
        data: {
          waqfId: nomination.waqfId,
          actorType: "birr_staff",
          actorUserId: reviewerUserId,
          action: "beneficiary.created",
          entityType: "Beneficiary",
          entityId: beneficiary.id,
          after: beneficiaryAuditSafe as any,
        },
      });

      return reviewed;
    });

    this.notifyProposer(reviewed.proposedByUserId, reviewed.name, "approved", reviewed.id).catch((err) => {
      console.error(`Failed to notify proposer of approved nomination "${reviewed.id}":`, err);
    });
    return reviewed;
  }

  async reject(id: string, input: RejectBeneficiaryNominationInput, reviewerUserId: string) {
    const reviewed = await prisma.$transaction(async (tx) => {
      const nomination = await this.loadPending(tx, id);
      const reviewed = await tx.beneficiaryNomination.update({
        where: { id },
        data: {
          status: "rejected",
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
          reviewNotes: input.reviewNotes.trim(),
        },
      });
      const { bankDetailsEncrypted: _nominationBankDetails, ...nominationAuditSafe } = nomination;
      const { bankDetailsEncrypted: _reviewedBankDetails, ...reviewedAuditSafe } = reviewed;
      await tx.auditLog.create({
        data: {
          waqfId: nomination.waqfId,
          actorType: "birr_staff",
          actorUserId: reviewerUserId,
          action: "beneficiary_nomination.rejected",
          entityType: "BeneficiaryNomination",
          entityId: id,
          before: nominationAuditSafe as any,
          after: reviewedAuditSafe as any,
        },
      });
      return reviewed;
    });

    this.notifyProposer(reviewed.proposedByUserId, reviewed.name, "rejected", reviewed.id).catch((err) => {
      console.error(`Failed to notify proposer of rejected nomination "${reviewed.id}":`, err);
    });
    return reviewed;
  }

  private async notifyProposer(
    proposedByUserId: string,
    name: string,
    outcome: "approved" | "rejected",
    nominationId: string,
  ): Promise<void> {
    await this.notificationsService.notify({
      recipientType: "founder_user",
      recipientUserId: proposedByUserId,
      type: "beneficiary_nomination.reviewed",
      title: `Your beneficiary nomination was ${outcome}`,
      body: `Your nomination "${name}" was ${outcome}.`,
      relatedEntityType: "BeneficiaryNomination",
      relatedEntityId: nominationId,
    });
  }

  private async loadPending(tx: Prisma.TransactionClient, id: string) {
    const nomination = await tx.beneficiaryNomination.findUnique({ where: { id } });
    if (!nomination) throw new NotFoundException(`BeneficiaryNomination "${id}" not found.`);
    if (nomination.status !== "pending") {
      throw new BadRequestException(`This nomination has already been reviewed (status: ${nomination.status}).`);
    }
    return nomination;
  }

  // Ops Console — every nomination for this waqf, any status. Staff-
  // facing, so bankDetailsEncrypted is decrypted for real display here
  // — same posture as BeneficiariesController's own read routes.
  async list(waqfId: string) {
    const nominations = await prisma.beneficiaryNomination.findMany({
      where: { waqfId },
      orderBy: { createdAt: "desc" },
      include: NOMINATION_INCLUDE,
    });
    return nominations.map((n) => {
      const { bankDetailsEncrypted, ...rest } = n;
      return { ...rest, bankDetails: bankDetailsEncrypted ? JSON.parse(this.encryption.decrypt(bankDetailsEncrypted)) : null };
    });
  }

  // Founder-Portal — only their own nominations for this waqf. Never
  // decrypted, never even the ciphertext field — a Founder proposing
  // bank details for someone else doesn't mean they get to read them
  // back afterward, consistent with the "propose-and-confirm only, no
  // read-back" convention this feature already follows.
  async listForFounder(waqfId: string, founderId: string) {
    const nominations = await prisma.beneficiaryNomination.findMany({
      where: { waqfId, proposedByFounderId: founderId },
      orderBy: { createdAt: "desc" },
      include: NOMINATION_INCLUDE,
    });
    return nominations.map(({ bankDetailsEncrypted, ...rest }) => rest);
  }
}

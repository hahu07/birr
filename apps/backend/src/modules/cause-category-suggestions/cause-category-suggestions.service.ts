import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { prisma, Prisma, WaqfType } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { NotificationsService } from "../notifications/notifications.service";

export interface ApproveCauseSuggestionFields {
  description: string;
  icon?: string;
  sortOrder?: number;
  typicalWaqfTypes?: WaqfType[];
}

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const NAME_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 500;
const REVIEW_NOTES_MAX_LENGTH = 500;

export class ProposeCauseSuggestionInput {
  @IsString()
  @IsNotEmpty({ message: "Name is required." })
  @MaxLength(NAME_MAX_LENGTH)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsString()
  waqfId?: string;
}

export class RejectCauseSuggestionInput {
  @IsString()
  @IsNotEmpty({ message: "A reason is required when rejecting a suggestion." })
  @MaxLength(REVIEW_NOTES_MAX_LENGTH)
  reviewNotes!: string;
}

const SUGGESTION_INCLUDE = {
  proposedByFounder: { select: { id: true, name: true } },
  proposedByUser: { select: { id: true, fullName: true } },
  waqf: { select: { id: true, name: true } },
  reviewedByUser: { select: { id: true, fullName: true } },
  resultingCategory: { select: { id: true, name: true } },
} as const;

@Injectable()
export class CauseCategorySuggestionsService {
  private readonly logger = new Logger(CauseCategorySuggestionsService.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  // Founder-Portal self-service — a Founder asking Birr's product team
  // to add something new to the standard catalog. Plain CRUD, not
  // governed_actions, same "organizational metadata, not a fiduciary act"
  // reasoning already established for WaqfCause/CauseCategory.
  async propose(input: ProposeCauseSuggestionInput, founderId: string, userId: string) {
    if (input.waqfId) {
      const waqf = await prisma.waqf.findFirst({
        where: { id: input.waqfId, foundation: { foundationFounders: { some: { founderId } } } },
      });
      if (!waqf) throw new BadRequestException(`Waqf "${input.waqfId}" does not belong to you.`);
    }
    const suggestion = await prisma.$transaction(async (tx) => {
      const suggestion = await tx.causeCategorySuggestion.create({
        data: {
          proposedByFounderId: founderId,
          proposedByUserId: userId,
          waqfId: input.waqfId,
          name: input.name.trim(),
          description: input.description?.trim() || undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "founder_user",
          actorUserId: userId,
          actorFounderId: founderId,
          action: "cause_category_suggestion.proposed",
          entityType: "CauseCategorySuggestion",
          entityId: suggestion.id,
          after: suggestion as any,
        },
      });
      return suggestion;
    });

    // No RolePermission row exists for this (plain CRUD, not
    // governed_actions — see approve()'s own comment on why this stays
    // platform_admin-only) — so there's no "eligible role" table to
    // query like GovernedActionsService.notifyProposed() does; the role
    // is simply hardcoded to match the controller's own @RequiresStaffRole.
    this.notifyPlatformAdmins(suggestion.id, suggestion.name).catch((err) => {
      this.logger.error(
        `Failed to notify platform_admin of new cause suggestion "${suggestion.id}":`,
        err instanceof Error ? err.stack : String(err),
      );
    });

    return suggestion;
  }

  private async notifyPlatformAdmins(suggestionId: string, name: string): Promise<void> {
    const admins = await prisma.birrStaff.findMany({
      where: { staffRole: "platform_admin", status: "active" },
      select: { userId: true },
    });
    await Promise.all(
      admins.map((admin) =>
        this.notificationsService.notify({
          recipientType: "birr_staff",
          recipientUserId: admin.userId,
          type: "cause_suggestion.pending",
          title: "New cause suggestion pending review",
          body: `A founder proposed a new cause: "${name}".`,
          linkUrl: "/ops/cause-categories",
          relatedEntityType: "CauseCategorySuggestion",
          relatedEntityId: suggestionId,
        }),
      ),
    );
  }

  /**
   * Same-authority write as CauseCategoriesService.create() — approving
   * performs the exact catalog-write action creating one directly does,
   * so this stays platform_admin-only too (enforced by the controller),
   * not "any staff" the way ConflictOfInterestDeclaration's review is.
   * Staff supplies icon/sortOrder/typicalWaqfTypes here — the Founder's
   * suggestion only ever carried name/description.
   */
  async approve(id: string, categoryFields: ApproveCauseSuggestionFields, reviewerUserId: string) {
    const description = categoryFields.description.trim();
    if (!description) {
      throw new BadRequestException("Description is required.");
    }
    let reviewed;
    try {
      reviewed = await prisma.$transaction(async (tx) => {
        const suggestion = await this.loadPending(tx, id);
        const category = await tx.causeCategory.create({
          data: {
            name: suggestion.name,
            description,
            icon: categoryFields.icon,
            sortOrder: categoryFields.sortOrder ?? 0,
            typicalWaqfTypes: categoryFields.typicalWaqfTypes ?? [],
          },
        });
        const reviewed = await tx.causeCategorySuggestion.update({
          where: { id },
          data: {
            status: "approved",
            reviewedByUserId: reviewerUserId,
            reviewedAt: new Date(),
            resultingCategoryId: category.id,
          },
        });
        await tx.auditLog.create({
          data: {
            waqfId: suggestion.waqfId,
            actorType: "birr_staff",
            actorUserId: reviewerUserId,
            action: "cause_category_suggestion.approved",
            entityType: "CauseCategorySuggestion",
            entityId: id,
            before: suggestion as any,
            after: reviewed as any,
          },
        });
        // The resulting CauseCategory is its own real create — audited
        // the same way CauseCategoriesService.create() audits any other
        // catalog entry, so it isn't distinguishable in the audit trail
        // from one staff typed in directly.
        await tx.auditLog.create({
          data: {
            actorType: "birr_staff",
            actorUserId: reviewerUserId,
            action: "cause_category.created",
            entityType: "CauseCategory",
            entityId: category.id,
            after: category as any,
          },
        });
        return reviewed;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException(
          "A cause category with this name already exists — reject this suggestion instead, or rename before approving.",
        );
      }
      throw err;
    }

    this.notifyProposer(reviewed.proposedByUserId, reviewed.name, "approved", reviewed.id).catch((err) => {
      this.logger.error(
        `Failed to notify proposer of approved suggestion "${reviewed.id}":`,
        err instanceof Error ? err.stack : String(err),
      );
    });
    return reviewed;
  }

  async reject(id: string, input: RejectCauseSuggestionInput, reviewerUserId: string) {
    const reviewed = await prisma.$transaction(async (tx) => {
      const suggestion = await this.loadPending(tx, id);
      const reviewed = await tx.causeCategorySuggestion.update({
        where: { id },
        data: {
          status: "rejected",
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
          reviewNotes: input.reviewNotes.trim(),
        },
      });
      await tx.auditLog.create({
        data: {
          waqfId: suggestion.waqfId,
          actorType: "birr_staff",
          actorUserId: reviewerUserId,
          action: "cause_category_suggestion.rejected",
          entityType: "CauseCategorySuggestion",
          entityId: id,
          before: suggestion as any,
          after: reviewed as any,
        },
      });
      return reviewed;
    });

    this.notifyProposer(reviewed.proposedByUserId, reviewed.name, "rejected", reviewed.id).catch((err) => {
      this.logger.error(
        `Failed to notify proposer of rejected suggestion "${reviewed.id}":`,
        err instanceof Error ? err.stack : String(err),
      );
    });
    return reviewed;
  }

  private async notifyProposer(
    proposedByUserId: string,
    name: string,
    outcome: "approved" | "rejected",
    suggestionId: string,
  ): Promise<void> {
    await this.notificationsService.notify({
      recipientType: "founder_user",
      recipientUserId: proposedByUserId,
      type: "cause_suggestion.reviewed",
      title: `Your cause suggestion was ${outcome}`,
      body: `Your suggestion "${name}" was ${outcome}.`,
      linkUrl: "/impact",
      relatedEntityType: "CauseCategorySuggestion",
      relatedEntityId: suggestionId,
    });
  }

  private async loadPending(tx: Prisma.TransactionClient, id: string) {
    const suggestion = await tx.causeCategorySuggestion.findUnique({ where: { id } });
    if (!suggestion) throw new NotFoundException(`CauseCategorySuggestion "${id}" not found.`);
    if (suggestion.status !== "pending") {
      throw new BadRequestException(`This suggestion has already been reviewed (status: ${suggestion.status}).`);
    }
    return suggestion;
  }

  // Staff review queue — every suggestion, any status.
  list() {
    return prisma.causeCategorySuggestion.findMany({
      orderBy: { createdAt: "desc" },
      include: SUGGESTION_INCLUDE,
    });
  }

  // Founder-Portal — only their own, so a Founder can track what they
  // proposed without seeing anyone else's. Wrapped in withFounderScope
  // (2026-09-26 audit fix) so this read is backed by the
  // founder_isolation RLS policy on proposedByFounderId, not just the
  // WHERE clause below alone — matching every other founder-scoped read.
  listForFounder(founderId: string) {
    return withFounderScope(founderId, (tx) =>
      tx.causeCategorySuggestion.findMany({
        where: { proposedByFounderId: founderId },
        orderBy: { createdAt: "desc" },
        include: SUGGESTION_INCLUDE,
      }),
    );
  }
}

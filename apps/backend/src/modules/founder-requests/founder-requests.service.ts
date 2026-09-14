import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsIn, IsObject, IsOptional, IsString } from "class-validator";
import { prisma, Prisma, FounderRequestType } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";

// One minimal required-key check per type, not full per-type DTOs —
// `details` only ever needs to carry enough for staff to know what's
// being asked before they go create the real governed_action themselves
// (see FounderRequest's own schema comment); it's never read by any
// automated code path, so validating its exact shape beyond "did the
// founder fill in the fields this type needs" would be enforcing a
// contract nothing downstream depends on.
//
// Deliberately no beneficiaryId anywhere below — a Founder never sees
// individual Beneficiary rows at all (BeneficiariesSection is an
// aggregate only; see that component's own comment on why beneficiary
// identity stays confidential from the donor, standard endowment
// practice). distribution_approval and beneficiary_criteria_change are
// instead named by causeId (a Founder does see their own causes) plus a
// free-text description — staff, who has full visibility, resolves
// which specific beneficiary this is about.
const REQUIRED_DETAIL_KEYS: Record<FounderRequestType, string[]> = {
  distribution_approval: ["causeId", "amount", "description"],
  investment_change: ["instrumentType", "proposedAllocation", "description"],
  beneficiary_criteria_change: ["causeId", "description"],
  asset_disposal: ["assetId", "reason"],
  other: [],
};

export class CreateFounderRequestInput {
  @IsString()
  waqfId!: string;

  @IsEnum(FounderRequestType)
  type!: FounderRequestType;

  @IsObject()
  details!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  note?: string;
}

export class DecideFounderRequestInput {
  @IsIn(["in_review", "actioned", "declined"])
  status!: "in_review" | "actioned" | "declined";

  @IsOptional()
  @IsString()
  reviewNote?: string;
}

const FOUNDER_REQUEST_INCLUDE = {
  waqf: { select: { id: true, name: true, type: true } },
  reviewedByStaff: { select: { id: true, user: { select: { fullName: true } } } },
} as const;

/**
 * The Founder Portal's "request" half of "view, request" (CLAUDE.md's
 * Tech principles) — a typed, trackable ask that a Founder can't turn
 * into a governed_action themselves. See FounderRequest's own schema
 * comment for why creating/deciding one never touches governed_actions
 * at all: it's staff's own decision, made through the normal Ops flow,
 * whether a request warrants one.
 */
@Injectable()
export class FounderRequestsService {
  // Same "requires an active caseload assignment, platform_admin exempt"
  // shape as BeneficiariesService.assertStaffCanAccessWaqf — a Founder's
  // request is exactly as sensitive as the beneficiary/asset/distribution
  // data it's asking staff to act on, so it gets the same scoping.
  async assertStaffCanAccessWaqf(waqfId: string, staff: { id: string; staffRole: string }): Promise<void> {
    if (staff.staffRole === "platform_admin") return;
    const assignment = await prisma.waqfCaseAssignment.findFirst({
      where: { waqfId, birrStaffId: staff.id, status: "active" },
      select: { id: true },
    });
    if (!assignment) {
      throw new ForbiddenException(
        "You don't have an active case assignment for this waqf — founder requests are scoped to assigned staff.",
      );
    }
  }

  async create(input: CreateFounderRequestInput, founderId: string) {
    const missing = REQUIRED_DETAIL_KEYS[input.type].filter((key) => input.details[key] === undefined || input.details[key] === null || input.details[key] === "");
    if (missing.length > 0) {
      throw new BadRequestException(`Missing required detail(s) for a "${input.type}" request: ${missing.join(", ")}.`);
    }

    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: input.waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) {
        throw new NotFoundException(`Waqf "${input.waqfId}" not found.`);
      }

      const created = await tx.founderRequest.create({
        data: {
          waqfId: input.waqfId,
          founderId,
          type: input.type,
          details: input.details as Prisma.InputJsonValue,
          note: input.note,
        },
        include: FOUNDER_REQUEST_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "founder_user",
          actorFounderId: founderId,
          action: "founder_request.created",
          entityType: "FounderRequest",
          entityId: created.id,
          after: { type: created.type, details: created.details, note: created.note } as Prisma.InputJsonValue,
        },
      });

      return created;
    });
  }

  // waqfId narrows to one fund's own requests (the waqf detail page's
  // own RequestsSection) — still just an extra WHERE clause, since the
  // withFounderScope transaction + founderId in the where clause already
  // guarantee this founder owns whichever waqf they pass in.
  listForFounder(founderId: string, waqfId?: string) {
    return withFounderScope(founderId, (tx) =>
      tx.founderRequest.findMany({
        where: { founderId, ...(waqfId ? { waqfId } : {}) },
        orderBy: { createdAt: "desc" },
        include: FOUNDER_REQUEST_INCLUDE,
      }),
    );
  }

  async findByIdForFounder(id: string, founderId: string) {
    return withFounderScope(founderId, (tx) =>
      tx.founderRequest.findFirst({ where: { id, founderId }, include: FOUNDER_REQUEST_INCLUDE }),
    );
  }

  // waqfId given: caller has already asserted access via
  // assertStaffCanAccessWaqf. Omitted: scoped to the staff member's own
  // active caseload, platform_admin sees everything — same shape as
  // BeneficiariesService.list().
  list(waqfId: string | undefined, staff: { id: string; staffRole: string }) {
    if (waqfId) {
      return prisma.founderRequest.findMany({ where: { waqfId }, orderBy: { createdAt: "desc" }, include: FOUNDER_REQUEST_INCLUDE });
    }
    if (staff.staffRole === "platform_admin") {
      return prisma.founderRequest.findMany({ orderBy: { createdAt: "desc" }, include: FOUNDER_REQUEST_INCLUDE, take: 200 });
    }
    return prisma.founderRequest.findMany({
      where: { waqf: { caseAssignments: { some: { birrStaffId: staff.id, status: "active" } } } },
      orderBy: { createdAt: "desc" },
      include: FOUNDER_REQUEST_INCLUDE,
      take: 200,
    });
  }

  findById(id: string) {
    return prisma.founderRequest.findUnique({ where: { id }, include: FOUNDER_REQUEST_INCLUDE });
  }

  async decide(id: string, input: DecideFounderRequestInput, staff: { id: string; userId: string }) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.founderRequest.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Founder request "${id}" not found.`);
      if (existing.status === "actioned" || existing.status === "declined") {
        throw new BadRequestException(`This request was already marked "${existing.status}" and can't be changed further.`);
      }

      const updated = await tx.founderRequest.update({
        where: { id },
        data: {
          status: input.status,
          reviewedByStaffId: staff.id,
          reviewNote: input.reviewNote,
          reviewedAt: input.status === "actioned" || input.status === "declined" ? new Date() : existing.reviewedAt,
        },
        include: FOUNDER_REQUEST_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          waqfId: existing.waqfId,
          actorType: "birr_staff",
          actorUserId: staff.userId,
          action: `founder_request.${input.status}`,
          entityType: "FounderRequest",
          entityId: id,
          before: { status: existing.status } as Prisma.InputJsonValue,
          after: { status: updated.status, reviewNote: updated.reviewNote } as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma, Prisma, CaseAssignmentRole, BirrStaffRole } from "@birr/db";

export interface AssignInput {
  waqfId: string;
  birrStaffId: string;
  assignmentRole: CaseAssignmentRole;
  actorUserId: string;
}

export type CaseAssignmentCloseStatus = "closed" | "reassigned";

export interface CloseInput {
  id: string;
  status: CaseAssignmentCloseStatus;
  actorUserId: string;
}

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

// CaseAssignmentRole and BirrStaffRole are separate enums with no 1:1
// naming overlap beyond "mutawalli_officer" — assigning a BirrStaff
// member to a case role their actual staffRole has no business holding
// (e.g. a compliance_officer taking the "auditor" case role) would let
// them start receiving message/beneficiary-nomination notifications
// meant for a different function's reviewer, defeating the segregation
// this mapping exists to enforce.
const ASSIGNABLE_STAFF_ROLES: Record<CaseAssignmentRole, BirrStaffRole[]> = {
  mutawalli_officer: ["mutawalli_officer"],
  investment_officer: ["investment_committee"],
  compliance_reviewer: ["compliance_officer"],
  shariah_reviewer: ["shariah_board_member"],
  auditor: ["audit_committee", "external_auditor"],
};

@Injectable()
export class WaqfCaseAssignmentsService {
  async assign(input: AssignInput) {
    const assignee = await prisma.birrStaff.findUnique({ where: { id: input.birrStaffId } });
    if (!assignee) {
      throw new NotFoundException(`BirrStaff "${input.birrStaffId}" not found.`);
    }
    if (!ASSIGNABLE_STAFF_ROLES[input.assignmentRole].includes(assignee.staffRole)) {
      throw new BadRequestException(
        `A "${assignee.staffRole}" staff member can't hold the "${input.assignmentRole}" case role — only ${ASSIGNABLE_STAFF_ROLES[input.assignmentRole].join(" or ")} can.`,
      );
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const assignment = await tx.waqfCaseAssignment.create({
          data: {
            waqfId: input.waqfId,
            birrStaffId: input.birrStaffId,
            assignmentRole: input.assignmentRole,
          },
        });

        await tx.auditLog.create({
          data: {
            waqfId: input.waqfId,
            actorType: "birr_staff",
            actorUserId: input.actorUserId,
            action: "waqf_case_assignment.assigned",
            entityType: "WaqfCaseAssignment",
            entityId: assignment.id,
            after: assignment as any,
          },
        });

        return assignment;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(
          `BirrStaff "${input.birrStaffId}" already holds role "${input.assignmentRole}" on waqf "${input.waqfId}".`,
        );
      }
      throw err;
    }
  }

  async close(input: CloseInput) {
    const assignment = await prisma.waqfCaseAssignment.findUnique({
      where: { id: input.id },
    });
    if (!assignment) {
      throw new NotFoundException(`Assignment "${input.id}" not found.`);
    }
    if (assignment.status !== "active") {
      throw new BadRequestException(
        `Assignment "${assignment.id}" is already ${assignment.status}.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const closed = await tx.waqfCaseAssignment.update({
        where: { id: assignment.id },
        data: { status: input.status, closedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          waqfId: assignment.waqfId,
          actorType: "birr_staff",
          actorUserId: input.actorUserId,
          action: `waqf_case_assignment.${input.status}`,
          entityType: "WaqfCaseAssignment",
          entityId: assignment.id,
          before: assignment as any,
          after: closed as any,
        },
      });

      return closed;
    });
  }

  findById(id: string) {
    return prisma.waqfCaseAssignment.findUnique({ where: { id } });
  }

  list(filter: { waqfId?: string; birrStaffId?: string }) {
    return prisma.waqfCaseAssignment.findMany({
      where: {
        waqfId: filter.waqfId,
        birrStaffId: filter.birrStaffId,
      },
      include: { waqf: true },
      orderBy: { assignedAt: "desc" },
    });
  }
}

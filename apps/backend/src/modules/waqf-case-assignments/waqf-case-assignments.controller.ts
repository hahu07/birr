import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { IsEnum, IsIn, IsString } from "class-validator";
import {
  WaqfCaseAssignmentsService,
  CaseAssignmentCloseStatus,
} from "./waqf-case-assignments.service";
import {
  AuthenticatedBirrStaff,
  CurrentBirrStaff,
} from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { CaseAssignmentRole } from "@birr/db";

const CLOSE_STATUSES = ["closed", "reassigned"] as const;

class AssignBody {
  @IsString()
  waqfId!: string;

  @IsString()
  birrStaffId!: string;

  @IsEnum(CaseAssignmentRole)
  assignmentRole!: CaseAssignmentRole;
}

class CloseBody {
  @IsIn(CLOSE_STATUSES)
  status!: CaseAssignmentCloseStatus;
}

// No @RequiresPermission here — not a governed_actions permission, same
// bootstrap-scope reasoning already applied to Founders/BirrStaff/Asset
// registration. No permission is seeded for "who may assign caseloads."
// Mutating routes ARE gated by @RequiresStaffRole though (added after a
// codebase audit found this controller had no authorization check at
// all — any authenticated staff member could assign any other staff
// member to any waqf, and message/beneficiary-nomination recipient
// resolution both key off active case assignments, making this a real
// confidentiality gap, not just a style issue).
@Controller("waqf-case-assignments")
export class WaqfCaseAssignmentsController {
  constructor(private readonly service: WaqfCaseAssignmentsService) {}

  @Post()
  @RequiresStaffRole(["platform_admin", "mutawalli_officer"])
  assign(@Body() body: AssignBody, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.assign({ ...body, actorUserId: staff.userId });
  }

  @Post(":id/close")
  @RequiresStaffRole(["platform_admin", "mutawalli_officer"])
  close(
    @Param("id") id: string,
    @Body() body: CloseBody,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.close({ id, status: body.status, actorUserId: staff.userId });
  }

  @Get()
  list(@Query("waqfId") waqfId?: string, @Query("birrStaffId") birrStaffId?: string) {
    return this.service.list({ waqfId, birrStaffId });
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const assignment = await this.service.findById(id);
    if (!assignment) throw new NotFoundException(`Assignment "${id}" not found.`);
    return assignment;
  }
}

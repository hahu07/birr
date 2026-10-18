import { Body, Controller, Get, NotFoundException, Param, Post } from "@nestjs/common";
import { IsIn, IsOptional, IsString } from "class-validator";
import {
  ConflictOfInterestDeclarationsService,
  CoiReviewOutcome,
} from "./conflict-of-interest-declarations.service";
import {
  AuthenticatedBirrStaff,
  CurrentBirrStaff,
} from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";

const REVIEW_OUTCOMES = ["reviewed", "cleared", "escalated"] as const;

class DeclareBody {
  @IsOptional()
  @IsString()
  waqfId?: string;

  @IsString()
  declarationText!: string;
}

class ReviewBody {
  @IsIn(REVIEW_OUTCOMES)
  status!: CoiReviewOutcome;
}

// No @RequiresPermission here — this isn't a governed_actions permission.
// Any active BirrStaff may declare a conflict; reviewing one (someone
// else's — the service and the DB enforce "not the same person") is
// compliance_officer-only (owner decision, 2026-10-18).
@Controller("conflict-of-interest-declarations")
export class ConflictOfInterestDeclarationsController {
  constructor(private readonly service: ConflictOfInterestDeclarationsService) {}

  @Post()
  declare(@Body() body: DeclareBody, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.declare({
      birrStaffId: staff.id,
      waqfId: body.waqfId,
      declarationText: body.declarationText,
    });
  }

  @Post(":id/review")
  @RequiresStaffRole("compliance_officer")
  review(
    @Param("id") id: string,
    @Body() body: ReviewBody,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.review({
      id,
      status: body.status,
      reviewerUserId: staff.userId,
    });
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const declaration = await this.service.findById(id);
    if (!declaration) throw new NotFoundException(`Declaration "${id}" not found.`);
    return declaration;
  }
}

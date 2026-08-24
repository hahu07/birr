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

// No @RequiresPermission here — this isn't a governed_actions permission,
// so there's no role-eligibility gate to check beyond "not the same
// person," which the service (and the DB) already enforce. Any active
// BirrStaff may declare or review (someone else's) conflict.
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

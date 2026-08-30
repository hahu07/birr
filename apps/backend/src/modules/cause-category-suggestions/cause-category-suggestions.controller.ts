import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { Request } from "express";
import { WaqfType } from "@birr/db";
import {
  ApproveCauseSuggestionFields,
  CauseCategorySuggestionsService,
  ProposeCauseSuggestionInput,
  RejectCauseSuggestionInput,
} from "./cause-category-suggestions.service";
import { resolveFounderFromSession, resolveUserFromSession } from "../../common/auth/current-founder";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { Public } from "../../common/guards/public.decorator";

// Mirrors CreateCauseCategoryInput's own icon/sortOrder/typicalWaqfTypes
// fields exactly — approving a suggestion is the same catalog-write
// shape as creating a category directly, just sourced from a proposal's
// name/description instead of a fresh form.
class ApproveBody implements ApproveCauseSuggestionFields {
  @IsString()
  @IsNotEmpty({ message: "Description is required." })
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(WaqfType, { each: true })
  typicalWaqfTypes?: WaqfType[];
}

// @Public() — reachable by a signed-in Founder proposing/listing their
// own suggestions (Founder-Portal self-service, same posture as
// WaqfCausesController's select()/unselect()); writes that decide a
// suggestion (approve/reject) are platform_admin-only regardless, same
// authority level as CauseCategoriesController's own write gate.
@Public()
@Controller("cause-category-suggestions")
export class CauseCategorySuggestionsController {
  constructor(private readonly service: CauseCategorySuggestionsService) {}

  @Post()
  async propose(@Body() body: ProposeCauseSuggestionInput, @Req() request: Request) {
    const [founder, user] = await Promise.all([resolveFounderFromSession(request), resolveUserFromSession(request)]);
    return this.service.propose(body, founder.id, user.id);
  }

  @Post(":id/approve")
  @RequiresStaffRole("platform_admin")
  approve(@Param("id") id: string, @Body() body: ApproveBody, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.approve(id, body, staff.userId);
  }

  @Post(":id/reject")
  @RequiresStaffRole("platform_admin")
  reject(
    @Param("id") id: string,
    @Body() body: RejectCauseSuggestionInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.reject(id, body, staff.userId);
  }

  // A staff session sees the full review queue; a Founder session sees
  // only their own. Unlike WaqfCausesController.list()'s no-session
  // fallback (an established quirk elsewhere in this app, not repeated
  // here deliberately), this data has no legitimate reason to be
  // reachable with no session at all — both branches below throw their
  // own 401 in that case.
  @Get()
  async list(@Req() request: Request) {
    if (await isBirrStaffSession(request)) {
      return this.service.list();
    }
    const founder = await resolveFounderFromSession(request);
    return this.service.listForFounder(founder.id);
  }
}

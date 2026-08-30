import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { Request } from "express";
import {
  CauseCategoriesService,
  CreateCauseCategoryInput,
  UpdateCauseCategoryInput,
} from "./cause-categories.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { Public } from "../../common/guards/public.decorator";

// @Public() — the standard catalog a Founder picks causes from when
// setting up their own Waqf Fund, so it has to be readable outside a
// Birr-staff session (see list() below). Every write stays
// platform_admin-only, same as PlatformSettingsController/
// CompliancePolicySetsController.
@Public()
@Controller("cause-categories")
export class CauseCategoriesController {
  constructor(private readonly service: CauseCategoriesService) {}

  @Post()
  @RequiresStaffRole("platform_admin")
  create(@Body() body: CreateCauseCategoryInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Put(":id")
  @RequiresStaffRole("platform_admin")
  update(
    @Param("id") id: string,
    @Body() body: UpdateCauseCategoryInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.update(id, body, staff.userId);
  }

  @Post(":id/retire")
  @RequiresStaffRole("platform_admin")
  async retire(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    await this.service.retire(id, staff.userId);
    return { ok: true };
  }

  @Post(":id/restore")
  @RequiresStaffRole("platform_admin")
  async restore(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    await this.service.restore(id, staff.userId);
    return { ok: true };
  }

  // Retired entries are only ever shown to a signed-in Birr staff member
  // (the admin screen needs to un-retire one) — a Founder's picker, and
  // any unauthenticated caller, only ever sees what's currently on offer.
  @Get()
  async list(@Query("includeRetired") includeRetired: string | undefined, @Req() request: Request) {
    const wantsRetired = includeRetired === "true" && (await isBirrStaffSession(request));
    return this.service.list(wantsRetired);
  }
}

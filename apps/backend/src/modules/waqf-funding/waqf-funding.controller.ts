import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import {
  WaqfFundingService,
  UpsertCorpusMinimumInput,
  UpdateWaqfFundingSettingsInput,
} from "./waqf-funding.service";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { Public } from "../../common/guards/public.decorator";

// @Public() on the reads — a founder's own onboarding form needs these
// to show "$X minimum" / "at least N%" guidance before submitting, not
// just Birr staff managing them (same reasoning CauseCategoriesController
// gives for its own public GET). Writes are platform_admin-only, same
// posture as TrusteeLicensesController/PlatformSettingsController — a
// silent, unaudited change to either of these numbers is a real
// financial-policy risk, not a per-waqf governance decision.
@Public()
@Controller("waqf-funding")
export class WaqfFundingController {
  constructor(private readonly service: WaqfFundingService) {}

  @Get("corpus-minimums")
  listCorpusMinimums() {
    return this.service.listCorpusMinimums();
  }

  @Put("corpus-minimums/:currency")
  @RequiresStaffRole("platform_admin")
  upsertCorpusMinimum(
    @Param("currency") currency: string,
    @Body() body: UpsertCorpusMinimumInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.upsertCorpusMinimum(currency, body, staff.userId);
  }

  @Get("contribution-minimums")
  listContributionMinimums() {
    return this.service.listContributionMinimums();
  }

  @Put("contribution-minimums/:currency")
  @RequiresStaffRole("platform_admin")
  upsertContributionMinimum(
    @Param("currency") currency: string,
    @Body() body: UpsertCorpusMinimumInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.upsertContributionMinimum(currency, body, staff.userId);
  }

  @Get("settings")
  getSettings() {
    return this.service.getSettings();
  }

  @Put("settings")
  @RequiresStaffRole("platform_admin")
  updateSettings(@Body() body: UpdateWaqfFundingSettingsInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.updateSettings(body, staff.userId);
  }
}

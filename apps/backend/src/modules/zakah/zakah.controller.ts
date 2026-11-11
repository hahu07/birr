import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CreateZakahRulesetInput, UpdateZakahRulesetDraftInput, ZakahService } from "./zakah.service";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { Public } from "../../common/guards/public.decorator";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// Approving a ruleset or setting prices isn't here: both are governed
// actions (zakah.ruleset_approve, zakah.metal_price_set), proposed and
// decided through POST /governed-actions like every other one.
@Controller("zakah")
export class ZakahController {
  constructor(private readonly service: ZakahService) {}

  // Public: the calculator needs both before anyone signs in, and
  // neither holds anything private — the live rulings and today's prices.
  @Public()
  @Get("rulesets/current")
  currentRulesets() {
    return this.service.listCurrentRulesets();
  }

  @Public()
  @Get("metal-prices/current")
  currentMetalPrices() {
    return this.service.currentMetalPrices();
  }

  // Staff-only reads (no @Public): drafts and the full price history.
  @Get("rulesets")
  listRulesets() {
    return this.service.listRulesets();
  }

  @Get("metal-prices")
  listMetalPrices() {
    return this.service.listMetalPrices();
  }

  @Post("rulesets")
  @RequiresAccess("zakah.ruleset_draft")
  createDraft(@Body() body: CreateZakahRulesetInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.createDraft(body, staff.userId);
  }

  @Patch("rulesets/:id")
  @RequiresAccess("zakah.ruleset_draft")
  updateDraft(
    @Param("id") id: string,
    @Body() body: UpdateZakahRulesetDraftInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.service.updateDraft(id, body, staff.userId);
  }
}

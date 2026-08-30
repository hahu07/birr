import { Controller, Get, Param, Req } from "@nestjs/common";
import { Request } from "express";
import { FinancialReportsService } from "./financial-reports.service";
import { isBirrStaffSession, resolveBirrStaffFromSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession, resolveUserFromSession } from "../../common/auth/current-founder";
import { Public } from "../../common/guards/public.decorator";

// @Public() — dual-reachable, same "authenticated a different way"
// posture as every other dual-session controller this session
// (MessagesController, AssetsController). No @RequiresPermission here
// (unlike ComplianceReportsController's compliance.report_export) —
// that guard is staff-only by construction and can't gate a
// dual-reachable route; the ownership check inside the service is what
// actually protects the founder branch.
@Public()
@Controller("financial-reports")
export class FinancialReportsController {
  constructor(private readonly service: FinancialReportsService) {}

  @Get(":waqfId")
  async generate(@Param("waqfId") waqfId: string, @Req() request: Request) {
    if (await isBirrStaffSession(request)) {
      const staff = await resolveBirrStaffFromSession(request);
      return this.service.generate(waqfId, { actorType: "birr_staff", actorUserId: staff.userId });
    }
    const user = await resolveUserFromSession(request);
    const founder = await resolveFounderFromSession(request);
    return this.service.generate(waqfId, { actorType: "founder_user", actorUserId: user.id, founderId: founder.id });
  }
}

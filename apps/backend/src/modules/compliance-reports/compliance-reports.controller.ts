import { Controller, Get, Param, Req } from "@nestjs/common";
import { Request } from "express";
import { ComplianceReportsService } from "./compliance-reports.service";
import { AuthenticatedBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresPermission } from "../../common/guards/permission.guard";

type AuthenticatedRequest = Request & { birrStaff: AuthenticatedBirrStaff };

@Controller("compliance-reports")
export class ComplianceReportsController {
  constructor(private readonly service: ComplianceReportsService) {}

  @Get(":waqfId")
  @RequiresPermission("maker", "compliance.report_export")
  generate(@Param("waqfId") waqfId: string, @Req() request: AuthenticatedRequest) {
    return this.service.generate(waqfId, request.birrStaff.userId);
  }
}

import { Module } from "@nestjs/common";
import { ComplianceReportsService } from "./compliance-reports.service";
import { ComplianceReportsController } from "./compliance-reports.controller";
import { TrusteeLicensesModule } from "../trustee-licenses/trustee-licenses.module";
import { CompliancePolicySetsModule } from "../compliance-policy-sets/compliance-policy-sets.module";

@Module({
  imports: [TrusteeLicensesModule, CompliancePolicySetsModule],
  controllers: [ComplianceReportsController],
  providers: [ComplianceReportsService],
  exports: [ComplianceReportsService],
})
export class ComplianceReportsModule {}

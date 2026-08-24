import { Module } from "@nestjs/common";
import { CompliancePolicySetsService } from "./compliance-policy-sets.service";
import { CompliancePolicySetsController } from "./compliance-policy-sets.controller";

@Module({
  controllers: [CompliancePolicySetsController],
  providers: [CompliancePolicySetsService],
  exports: [CompliancePolicySetsService],
})
export class CompliancePolicySetsModule {}

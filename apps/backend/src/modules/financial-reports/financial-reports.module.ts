import { Module } from "@nestjs/common";
import { FinancialReportsService } from "./financial-reports.service";
import { FinancialReportsController } from "./financial-reports.controller";
import { DistributionsModule } from "../distributions/distributions.module";
import { WaqfProceedsModule } from "../waqf-proceeds/waqf-proceeds.module";

@Module({
  imports: [DistributionsModule, WaqfProceedsModule],
  controllers: [FinancialReportsController],
  providers: [FinancialReportsService],
  exports: [FinancialReportsService],
})
export class FinancialReportsModule {}

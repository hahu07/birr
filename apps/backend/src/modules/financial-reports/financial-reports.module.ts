import { Module } from "@nestjs/common";
import { FinancialReportsService } from "./financial-reports.service";
import { FinancialReportsController } from "./financial-reports.controller";
import { DistributionsModule } from "../distributions/distributions.module";

@Module({
  imports: [DistributionsModule],
  controllers: [FinancialReportsController],
  providers: [FinancialReportsService],
  exports: [FinancialReportsService],
})
export class FinancialReportsModule {}

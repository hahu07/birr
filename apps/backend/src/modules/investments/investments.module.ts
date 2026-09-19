import { Module } from "@nestjs/common";
import { InvestmentsService } from "./investments.service";
import { InvestmentsController } from "./investments.controller";
import { InvestmentTargetsService } from "./investment-targets.service";
import { InvestmentTargetsController } from "./investment-targets.controller";

@Module({
  controllers: [InvestmentsController, InvestmentTargetsController],
  providers: [InvestmentsService, InvestmentTargetsService],
  exports: [InvestmentsService, InvestmentTargetsService],
})
export class InvestmentsModule {}

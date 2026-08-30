import { Module } from "@nestjs/common";
import { InvestmentsModule } from "../investments/investments.module";
import { InvestmentPlacementsService } from "./investment-placements.service";
import { InvestmentPlacementsController } from "./investment-placements.controller";

@Module({
  imports: [InvestmentsModule],
  controllers: [InvestmentPlacementsController],
  providers: [InvestmentPlacementsService],
})
export class InvestmentPlacementsModule {}

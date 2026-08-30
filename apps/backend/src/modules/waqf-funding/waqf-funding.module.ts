import { Module } from "@nestjs/common";
import { WaqfFundingService } from "./waqf-funding.service";
import { WaqfFundingController } from "./waqf-funding.controller";

@Module({
  controllers: [WaqfFundingController],
  providers: [WaqfFundingService],
  exports: [WaqfFundingService],
})
export class WaqfFundingModule {}

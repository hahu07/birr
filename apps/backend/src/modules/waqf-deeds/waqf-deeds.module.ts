import { Module } from "@nestjs/common";
import { WaqfDeedsService } from "./waqf-deeds.service";
import { WaqfDeedsController } from "./waqf-deeds.controller";

@Module({
  controllers: [WaqfDeedsController],
  providers: [WaqfDeedsService],
  exports: [WaqfDeedsService],
})
export class WaqfDeedsModule {}

import { Module } from "@nestjs/common";
import { WaqfCausesService } from "./waqf-causes.service";
import { WaqfCausesController } from "./waqf-causes.controller";

@Module({
  controllers: [WaqfCausesController],
  providers: [WaqfCausesService],
  exports: [WaqfCausesService],
})
export class WaqfCausesModule {}

import { forwardRef, Module } from "@nestjs/common";
import { WaqfCausesService } from "./waqf-causes.service";
import { WaqfCausesController } from "./waqf-causes.controller";
import { WaqfProceedsModule } from "../waqf-proceeds/waqf-proceeds.module";

// forwardRef — WaqfProceedsModule now also imports this module (see its
// own comment), a genuine two-way dependency between these two.
@Module({
  imports: [forwardRef(() => WaqfProceedsModule)],
  controllers: [WaqfCausesController],
  providers: [WaqfCausesService],
  exports: [WaqfCausesService],
})
export class WaqfCausesModule {}

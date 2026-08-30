import { forwardRef, Module } from "@nestjs/common";
import { WaqfProceedsService } from "./waqf-proceeds.service";
import { WaqfProceedsController } from "./waqf-proceeds.controller";
import { WaqfCausesModule } from "../waqf-causes/waqf-causes.module";

// forwardRef — WaqfCausesModule already imports this module (for
// WaqfCausesService's own WaqfProceedsService dependency); this is the
// reverse edge of that same pair (WaqfProceedsService now calls back
// into WaqfCausesService — see WaqfProceedsService.record's own
// comment), a genuine two-way dependency between these two modules.
@Module({
  imports: [forwardRef(() => WaqfCausesModule)],
  controllers: [WaqfProceedsController],
  providers: [WaqfProceedsService],
  exports: [WaqfProceedsService],
})
export class WaqfProceedsModule {}

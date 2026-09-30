import { Module } from "@nestjs/common";
import { FunnelEventsService } from "./funnel-events.service";
import { FunnelEventsController } from "./funnel-events.controller";

@Module({
  controllers: [FunnelEventsController],
  providers: [FunnelEventsService],
  exports: [FunnelEventsService],
})
export class FunnelEventsModule {}

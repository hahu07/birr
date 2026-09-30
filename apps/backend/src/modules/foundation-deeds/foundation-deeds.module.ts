import { Module } from "@nestjs/common";
import { FoundationDeedsService } from "./foundation-deeds.service";
import { FoundationDeedsController } from "./foundation-deeds.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { FunnelEventsModule } from "../funnel-events/funnel-events.module";

@Module({
  imports: [NotificationsModule, FunnelEventsModule],
  controllers: [FoundationDeedsController],
  providers: [FoundationDeedsService],
  exports: [FoundationDeedsService],
})
export class FoundationDeedsModule {}

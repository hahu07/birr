import { Module } from "@nestjs/common";
import { WaqfsService } from "./waqfs.service";
import { WaqfsController } from "./waqfs.controller";
import { TrusteeLicensesModule } from "../trustee-licenses/trustee-licenses.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { FunnelEventsModule } from "../funnel-events/funnel-events.module";

@Module({
  imports: [TrusteeLicensesModule, NotificationsModule, FunnelEventsModule],
  controllers: [WaqfsController],
  providers: [WaqfsService],
  exports: [WaqfsService],
})
export class WaqfsModule {}

import { Module } from "@nestjs/common";
import { CauseImpactUpdatesService } from "./cause-impact-updates.service";
import { CauseImpactUpdatesController } from "./cause-impact-updates.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  providers: [CauseImpactUpdatesService],
  controllers: [CauseImpactUpdatesController],
})
export class CauseImpactUpdatesModule {}

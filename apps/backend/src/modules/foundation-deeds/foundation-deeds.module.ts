import { Module } from "@nestjs/common";
import { FoundationDeedsService } from "./foundation-deeds.service";
import { FoundationDeedsController } from "./foundation-deeds.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [FoundationDeedsController],
  providers: [FoundationDeedsService],
  exports: [FoundationDeedsService],
})
export class FoundationDeedsModule {}

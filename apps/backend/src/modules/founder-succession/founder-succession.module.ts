import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { FounderSuccessionService } from "./founder-succession.service";
import { FounderSuccessionController, FounderSuccessionStaffController } from "./founder-succession.controller";

/** Handing a Founder's primary contact role to someone new; see FounderSuccessionService. */
@Module({
  imports: [NotificationsModule],
  controllers: [FounderSuccessionController, FounderSuccessionStaffController],
  providers: [FounderSuccessionService],
  exports: [FounderSuccessionService],
})
export class FounderSuccessionModule {}

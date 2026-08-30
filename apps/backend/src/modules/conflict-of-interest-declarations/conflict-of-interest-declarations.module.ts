import { Module } from "@nestjs/common";
import { ConflictOfInterestDeclarationsService } from "./conflict-of-interest-declarations.service";
import { ConflictOfInterestDeclarationsController } from "./conflict-of-interest-declarations.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [ConflictOfInterestDeclarationsController],
  providers: [ConflictOfInterestDeclarationsService],
  exports: [ConflictOfInterestDeclarationsService],
})
export class ConflictOfInterestDeclarationsModule {}

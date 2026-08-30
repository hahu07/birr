import { Module } from "@nestjs/common";
import { TrusteeLicensesService } from "./trustee-licenses.service";
import { TrusteeLicensesController } from "./trustee-licenses.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [TrusteeLicensesController],
  providers: [TrusteeLicensesService],
  exports: [TrusteeLicensesService],
})
export class TrusteeLicensesModule {}

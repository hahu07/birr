import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { ResendNotificationEmailAdapter } from "./email/resend-notification.adapter";
import { SettingsModule } from "../../common/settings/settings.module";
import { WhatsAppOtpModule } from "../../common/whatsapp/whatsapp-otp.module";

@Module({
  imports: [SettingsModule, WhatsAppOtpModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, ResendNotificationEmailAdapter],
  exports: [NotificationsService],
})
export class NotificationsModule {}

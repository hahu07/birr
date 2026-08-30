import { Module } from "@nestjs/common";
import { InvitationsService } from "./invitations.service";
import { InvitationsController } from "./invitations.controller";
import { ResendInvitationEmailAdapter } from "./email/resend-invitation.adapter";
import { NotificationsModule } from "../notifications/notifications.module";
import { SettingsModule } from "../../common/settings/settings.module";

@Module({
  imports: [SettingsModule, NotificationsModule],
  controllers: [InvitationsController],
  providers: [InvitationsService, ResendInvitationEmailAdapter],
  exports: [InvitationsService],
})
export class InvitationsModule {}

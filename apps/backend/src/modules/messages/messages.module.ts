import { Module } from "@nestjs/common";
import { MessagesService } from "./messages.service";
import { MessagesController } from "./messages.controller";
import { MessageAttachmentStorageService } from "./message-attachment-storage.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessageAttachmentStorageService],
  exports: [MessagesService],
})
export class MessagesModule {}

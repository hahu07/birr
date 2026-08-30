import { Module } from "@nestjs/common";
import { CauseCategorySuggestionsService } from "./cause-category-suggestions.service";
import { CauseCategorySuggestionsController } from "./cause-category-suggestions.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  providers: [CauseCategorySuggestionsService],
  controllers: [CauseCategorySuggestionsController],
})
export class CauseCategorySuggestionsModule {}

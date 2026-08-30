import { Module } from "@nestjs/common";
import { CauseCategoriesService } from "./cause-categories.service";
import { CauseCategoriesController } from "./cause-categories.controller";

@Module({
  providers: [CauseCategoriesService],
  controllers: [CauseCategoriesController],
  exports: [CauseCategoriesService],
})
export class CauseCategoriesModule {}

import { Module } from "@nestjs/common";
import { CauseCategoriesService } from "./cause-categories.service";
import { CauseCategoriesController } from "./cause-categories.controller";
import { CauseCategoryDocumentStorageService } from "./cause-category-document-storage.service";

@Module({
  providers: [CauseCategoriesService, CauseCategoryDocumentStorageService],
  controllers: [CauseCategoriesController],
  exports: [CauseCategoriesService],
})
export class CauseCategoriesModule {}

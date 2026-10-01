import { Module } from "@nestjs/common";
import { BlogService } from "./blog.service";
import { BlogController } from "./blog.controller";
import { BlogImageStorageService } from "./blog-image-storage.service";

@Module({
  controllers: [BlogController],
  providers: [BlogService, BlogImageStorageService],
  exports: [BlogService],
})
export class BlogModule {}

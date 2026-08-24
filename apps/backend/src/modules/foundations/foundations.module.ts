import { Module } from "@nestjs/common";
import { FoundationsService } from "./foundations.service";
import { FoundationsController } from "./foundations.controller";

@Module({
  controllers: [FoundationsController],
  providers: [FoundationsService],
  exports: [FoundationsService],
})
export class FoundationsModule {}

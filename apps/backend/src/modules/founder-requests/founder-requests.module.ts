import { Module } from "@nestjs/common";
import { FounderRequestsService } from "./founder-requests.service";
import { FounderRequestsController } from "./founder-requests.controller";

@Module({
  providers: [FounderRequestsService],
  controllers: [FounderRequestsController],
  exports: [FounderRequestsService],
})
export class FounderRequestsModule {}

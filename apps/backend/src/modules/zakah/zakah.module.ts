import { Module } from "@nestjs/common";
import { ZakahController } from "./zakah.controller";
import { ZakahService } from "./zakah.service";

@Module({
  controllers: [ZakahController],
  providers: [ZakahService],
  exports: [ZakahService],
})
export class ZakahModule {}

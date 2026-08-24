import { Module } from "@nestjs/common";
import { BirrStaffService } from "./birr-staff.service";
import { BirrStaffController } from "./birr-staff.controller";

@Module({
  controllers: [BirrStaffController],
  providers: [BirrStaffService],
  exports: [BirrStaffService],
})
export class BirrStaffModule {}

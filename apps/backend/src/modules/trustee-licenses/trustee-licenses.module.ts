import { Module } from "@nestjs/common";
import { TrusteeLicensesService } from "./trustee-licenses.service";
import { TrusteeLicensesController } from "./trustee-licenses.controller";

@Module({
  controllers: [TrusteeLicensesController],
  providers: [TrusteeLicensesService],
  exports: [TrusteeLicensesService],
})
export class TrusteeLicensesModule {}

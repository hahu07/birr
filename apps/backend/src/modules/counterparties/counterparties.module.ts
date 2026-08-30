import { Module } from "@nestjs/common";
import { CounterpartiesService } from "./counterparties.service";
import { CounterpartiesController } from "./counterparties.controller";

@Module({
  controllers: [CounterpartiesController],
  providers: [CounterpartiesService],
  exports: [CounterpartiesService],
})
export class CounterpartiesModule {}

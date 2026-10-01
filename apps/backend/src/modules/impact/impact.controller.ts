import { Controller, Get } from "@nestjs/common";
import { ImpactService } from "./impact.service";
import { Public } from "../../common/guards/public.decorator";

@Controller("impact")
export class ImpactController {
  constructor(private readonly service: ImpactService) {}

  // Public by design — aggregate figures for the marketing homepage's
  // Impact section; no per-donor, per-founder or per-fund detail.
  @Public()
  @Get("summary")
  summary() {
    return this.service.summary();
  }
}

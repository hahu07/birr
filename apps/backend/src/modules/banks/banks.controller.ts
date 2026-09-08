import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/guards/public.decorator";
import { BanksService } from "./banks.service";

// Reference data (a bank name/code pair is Paystack's own public
// catalog, not anything scoped to a Founder or a waqf) — no session
// resolution needed at all, unlike most other @Public() routes in this
// codebase that still resolve a founder/staff identity inside the
// handler. Same shape as HealthController: @Public(), no params, no body.
@Public()
@Controller("banks")
export class BanksController {
  constructor(private readonly service: BanksService) {}

  @Get()
  list() {
    return this.service.listNigerianBanks();
  }
}

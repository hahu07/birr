import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { WaqfExpensesService, CreateWaqfExpenseInput } from "./waqf-expenses.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// No approve/reject route — recording an expense is plain staff CRUD,
// same trust tier as DistributionsController.create() (only
// waqf.milestone_complete, the real fiduciary checkpoint here, is
// governed — see WaqfExpense's own schema comment).
@Controller("waqf-expenses")
export class WaqfExpensesController {
  constructor(private readonly service: WaqfExpensesService) {}

  @Post()
  create(@Body() body: CreateWaqfExpenseInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  list(@Query("waqfId") waqfId: string) {
    return this.service.list(waqfId);
  }
}

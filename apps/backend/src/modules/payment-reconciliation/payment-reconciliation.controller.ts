import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { PaymentReconciliationService, ResolveReconciliationIssueInput, RunReconciliationInput } from "./payment-reconciliation.service";

/** Ops Console → Compliance → Payment Reconciliation. */
@Controller("payment-reconciliation")
export class PaymentReconciliationController {
  constructor(private readonly service: PaymentReconciliationService) {}

  @Get("runs")
  @RequiresAccess("payments.reconciliation_view")
  runs() {
    return this.service.listRuns();
  }

  @Get("issues")
  @RequiresAccess("payments.reconciliation_view")
  issues(@Query("status") status?: string, @Query("direction") direction?: string) {
    return this.service.listIssues({ status, direction });
  }

  @Post("runs")
  @RequiresAccess("payments.reconciliation_run")
  run(@Body() body: RunReconciliationInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.runForStaff(body, staff.userId);
  }

  @Post("issues/:id/recheck")
  @RequiresAccess("payments.reconciliation_resolve")
  recheck(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.recheck(id, staff.userId);
  }

  @Post("issues/:id/resolve")
  @RequiresAccess("payments.reconciliation_resolve")
  resolve(@Param("id") id: string, @Body() body: ResolveReconciliationIssueInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.resolve(id, body, staff.userId);
  }
}

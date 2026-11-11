import { Body, Controller, Get, NotFoundException, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { HoldZakahPaymentInput, InitiateZakahPaymentInput, ZakahPaymentsService } from "./zakah-payments.service";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { Public } from "../../common/guards/public.decorator";

// Public routes for a payer (no account of any kind) plus staff-only
// reads. Paystack's webhook arrives at ContributionsController's shared
// route, which hands zakah references on to ZakahPaymentsService.
@Controller("zakah-payments")
export class ZakahPaymentsController {
  constructor(private readonly service: ZakahPaymentsService) {}

  // Declared before ":id", or Nest would match it as an id.
  @Public()
  @Get("terms")
  terms() {
    return this.service.paymentTerms();
  }

  // Same tighter limit as POST /vault-contributions: each call is a real
  // Paystack API call, and this route is public.
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Public()
  @Post()
  initiate(@Body() body: InitiateZakahPaymentInput, @Req() request: Request) {
    return this.service.initiate(body, request.ip);
  }

  // Staff-only by the default guard: plain viewing, no permission needed.
  @Get()
  list() {
    return this.service.list();
  }

  @Get("ledger")
  ledger() {
    return this.service.ledgerBalances();
  }

  @Public()
  @Get(":id")
  async findById(@Param("id") id: string) {
    const payment = await this.service.findPublicStatus(id);
    if (!payment) throw new NotFoundException(`Zakah payment "${id}" not found.`);
    return payment;
  }

  // Called by the public status page when the payer returns from
  // checkout. It can only move a payment to what Paystack itself
  // reports, and is rate-limited per payment in the service.
  @Public()
  @Post(":id/verify")
  async verify(@Param("id") id: string) {
    const payment = await this.service.reconcile(id);
    if (!payment) throw new NotFoundException(`Zakah payment "${id}" not found.`);
    return payment;
  }

  // AML holds — staff only, never visible to the payer. Holding only
  // freezes money (Compliance or a Mutawalli Officer); releasing is
  // Compliance's alone (owner's decisions, 2026-11-11).
  @Post(":id/hold")
  @RequiresAccess("zakah.payment_hold")
  hold(@Param("id") id: string, @Body() body: HoldZakahPaymentInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.hold(id, body, staff.userId);
  }

  @Post(":id/release")
  @RequiresAccess("zakah.payment_release")
  release(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.release(id, staff.userId);
  }
}

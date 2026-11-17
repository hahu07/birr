import { Body, Controller, Get, NotFoundException, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { ClinicGiftsService, InitiateClinicGiftInput } from "./clinic-gifts.service";
import { Public } from "../../common/guards/public.decorator";

// Public routes for a giver with no account (2026-11-17, clinic slice 3).
// Paystack's webhook arrives at ContributionsController's shared route,
// which hands clinic gift references on to ClinicGiftsService. Staff see a
// clinic's gifts at GET /clinic-waqfs/:id/gifts.
@Controller("clinic-gifts")
export class ClinicGiftsController {
  constructor(private readonly service: ClinicGiftsService) {}

  // Declared before ":id", or Nest would match it as an id.
  @Public()
  @Get("terms/:slug")
  terms(@Param("slug") slug: string) {
    return this.service.givingTerms(slug);
  }

  // Same tighter limit as POST /vault-contributions and /zakah-payments:
  // each call is a real Paystack API call, and this route is public.
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Public()
  @Post()
  initiate(@Body() body: InitiateClinicGiftInput, @Req() request: Request) {
    return this.service.initiate(body, request.ip);
  }

  @Public()
  @Get(":id")
  async findById(@Param("id") id: string) {
    const gift = await this.service.findPublicStatus(id);
    if (!gift) throw new NotFoundException(`Gift "${id}" not found.`);
    return gift;
  }

  // Called by the return page when the giver comes back from checkout. It
  // can only move a gift to what Paystack itself reports, and is
  // rate-limited per gift in the service.
  @Public()
  @Post(":id/verify")
  async verify(@Param("id") id: string) {
    const gift = await this.service.reconcile(id);
    if (!gift) throw new NotFoundException(`Gift "${id}" not found.`);
    return gift;
  }
}

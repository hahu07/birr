import { Body, Controller, Get, NotFoundException, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import type { WaqfProgrammeProduct } from "@birr/db";
import { ProgrammeGiftsService, InitiateProgrammeGiftInput, InitiateFounderProgrammeGiftInput } from "./programme-gifts.service";
import { PRODUCTS } from "./programme-products";
import { ProgrammeReportService } from "./programme-report.service";
import { assertPrimaryContact, resolveFounderFromSession, resolveUserFromSession } from "../../common/auth/current-founder";
import { Public } from "../../common/guards/public.decorator";

// Public giving to a waqf programme (2026-11-17; the clinic waqf, clinic
// slice 3). Paystack's webhook arrives at ContributionsController's shared
// route, which hands programme gift references on to ProgrammeGiftsService.
// Staff see a programme's gifts at GET /waqf-programmes/:id/gifts. The
// public list of clinics and each clinic's report are in ClinicsModule.
@Controller("programme-gifts")
export class ProgrammeGiftsController {
  constructor(
    private readonly service: ProgrammeGiftsService,
    private readonly reports: ProgrammeReportService,
  ) {}

  private product(product: string): WaqfProgrammeProduct {
    if (!Object.hasOwn(PRODUCTS, product)) throw new NotFoundException(`No product "${product}".`);
    return product as WaqfProgrammeProduct;
  }

  // One product's established programmes, for its public list (need-based
  // NB3; Kifayah's /kifayah). The clinics keep their own GET /clinics.
  @Public()
  @Get("programmes/:product")
  programmes(@Param("product") product: string) {
    return this.service.publicProgrammes(this.product(product));
  }

  // One programme's public report, each pot on its own (need-based NB4).
  // The clinics keep their own fuller one at GET /clinics/:slug/report.
  @Public()
  @Get("programmes/:product/:slug/report")
  report(@Param("product") product: string, @Param("slug") slug: string) {
    return this.reports.publicReport(this.product(product), slug);
  }

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
  initiate(@Body() body: InitiateProgrammeGiftInput, @Req() request: Request) {
    return this.service.initiate(body, request.ip);
  }

  // A signed-in Founder's gifts (slice 4a). Not @Public: a Founder
  // session is required, and only the primary contact may give.
  @Get("founder/terms/:slug")
  async founderTerms(@Param("slug") slug: string, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.founderGivingTerms(founder.id, slug);
  }

  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @Post("founder")
  async initiateAsFounder(@Body() body: InitiateFounderProgrammeGiftInput, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    const user = await resolveUserFromSession(request);
    return this.service.initiateAsFounder(founder.id, user.id, body, request.ip);
  }

  @Get("founder/mine")
  async mine(@Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.listForFounder(founder.id);
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

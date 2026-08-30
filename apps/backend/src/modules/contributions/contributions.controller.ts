import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { IsEmail, IsEnum, IsNumberString, IsOptional, IsString } from "class-validator";
import { Request } from "express";
import { ContributionProvider } from "@birr/db";
import { ContributionsService } from "./contributions.service";
import { DistributionsService } from "../distributions/distributions.service";
import { assertPrimaryContact, resolveFounderFromSession } from "../../common/auth/current-founder";
import { isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { SESSION_COOKIE_NAME } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

class InitiateContributionBody {
  @IsString()
  waqfId!: string;

  @IsNumberString()
  amount!: string;

  // Not a fixed enum — validated against the live ContributionMinimum
  // table (see ContributionsService.initiate), which can grow without a
  // code change, so a static @IsEnum here would just be another place
  // to keep in sync.
  @IsString()
  currency!: string;

  @IsEnum(ContributionProvider)
  provider!: ContributionProvider;

  @IsOptional()
  @IsEmail()
  payerEmail?: string;
}

// @Public() — Founder-Portal self-service surface (initiate/findById) plus
// provider-signature-verified webhooks; neither needs a BirrStaff session.
@Public()
@Controller()
export class ContributionsController {
  constructor(
    private readonly service: ContributionsService,
    private readonly distributionsService: DistributionsService,
  ) {}

  // Self-service — same posture as POST /waqfs and POST /foundations,
  // including the primary-contact restriction (real money moving into
  // the org's waqf is an org-commitment action, not something any
  // viewer/requester colleague should be able to trigger unilaterally).
  @Post("contributions")
  async initiate(@Body() body: InitiateContributionBody, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    assertPrimaryContact(founder);
    return this.service.initiate({ ...body, founderId: founder.id });
  }

  // Dual-reachable, same branching AssetsController.list() already uses:
  // a Birr staff session sees any waqf's contributions unscoped (Ops
  // Console oversight/audit, same posture as Assets/Beneficiaries/
  // Distributions on the same waqf); a founder session is ownership-
  // scoped via listForWaqf — the portfolio page's funding-progress
  // section needs waqfId either way, but only requires it here for the
  // founder path (an ops-wide unfiltered list is a legitimate call too).
  @Get("contributions")
  async list(@Query("waqfId") waqfId: string | undefined, @Req() request: Request) {
    if (request.cookies?.[SESSION_COOKIE_NAME] && !(await isBirrStaffSession(request))) {
      if (!waqfId) throw new BadRequestException("Query parameter waqfId is required.");
      const founder = await resolveFounderFromSession(request);
      const contributions = await this.service.listForWaqf(waqfId, founder.id);
      if (!contributions) throw new ForbiddenException("This waqf fund doesn't belong to you.");
      return contributions;
    }
    return this.service.list(waqfId);
  }

  // Declared before "contributions/:id" — same routing reason as
  // DistributionsController.summary(). Staff-only, checked manually
  // since this whole controller is @Public() (see the class decorator)
  // — every other route here handles its own auth differently
  // (provider-signature webhooks, founder-session self-service), so
  // there's no shared staff-only guard to lean on for this one.
  @Get("contributions/platform-summary")
  async platformSummary(@Req() request: Request) {
    if (!(await isBirrStaffSession(request))) {
      throw new ForbiddenException("Staff session required.");
    }
    return this.service.platformSummary();
  }

  // Founder self-service — same session-resolution pattern as initiate()
  // above. Confirmed-only total raised across every waqf this founder
  // has established, grouped by currency — the founder-scoped
  // counterpart to platformSummary() above, for the Founder Portal's own
  // Overview page. Declared before "contributions/:id" — same route-
  // ordering reason as platformSummary().
  @Get("contributions/founder-summary")
  async founderSummary(@Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.founderSummary(founder.id);
  }

  // Polling target for the frontend after redirect/QR display — no
  // founder-session check needed beyond knowing the id, same posture
  // as GET /waqfs/:id.
  @Get("contributions/:id")
  async findById(@Param("id") id: string) {
    const contribution = await this.service.findById(id);
    if (!contribution) throw new NotFoundException(`Contribution "${id}" not found.`);
    return contribution;
  }

  // Never founder-session-authenticated — called by the provider, not a
  // logged-in donor. Security is entirely the signature check inside
  // ContributionsService.handleWebhook(); req.body here is the raw
  // Buffer main.ts's bootstrap carve-out preserves for exactly this
  // route family (see main.ts's own comment).
  @Post("webhooks/stripe")
  stripeWebhook(@Req() request: Request) {
    return this.handleWebhook("stripe", request);
  }

  @Post("webhooks/paystack")
  paystackWebhook(@Req() request: Request) {
    return this.handleWebhook("paystack", request);
  }

  @Post("webhooks/stablecoin")
  stablecoinWebhook(@Req() request: Request) {
    return this.handleWebhook("stablecoin", request);
  }

  private async handleWebhook(provider: ContributionProvider, request: Request) {
    const rawBody = request.body;
    if (!Buffer.isBuffer(rawBody)) {
      // Would indicate main.ts's raw-body carve-out isn't wired for this
      // path — fail loudly rather than silently accepting an
      // unverifiable (already-JSON-parsed) body.
      throw new UnauthorizedException("Webhook body was not preserved as raw bytes.");
    }
    const headers = request.headers as Record<string, string | undefined>;

    // Paystack supports only one configured webhook URL per account —
    // both inbound charge.* events and outbound (payout) transfer.*
    // events arrive at this same route. Try the payout parser first: it
    // returns null both for "wrong event family" and "bad signature",
    // so either case safely falls through to the charge.* path below,
    // which is what actually 401s on a genuinely invalid signature. This
    // only works because both event families are signed with the same
    // PAYSTACK_SECRET_KEY and the same HMAC-SHA512 scheme — see
    // DistributionsService.handlePayoutWebhook's own comment.
    if (provider === "paystack") {
      const payoutResult = await this.distributionsService.handlePayoutWebhook(rawBody, headers);
      if (payoutResult !== null) return payoutResult;
    }

    return this.service.handleWebhook(provider, rawBody, headers);
  }
}

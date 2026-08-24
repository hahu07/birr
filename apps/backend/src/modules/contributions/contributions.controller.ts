import { Body, Controller, Get, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { IsEmail, IsEnum, IsNumberString, IsOptional, IsString } from "class-validator";
import { Request } from "express";
import { ContributionProvider } from "@birr/db";
import { ContributionsService } from "./contributions.service";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
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
  constructor(private readonly service: ContributionsService) {}

  // Self-service — same posture as POST /waqfs and POST /foundations.
  @Post("contributions")
  async initiate(@Body() body: InitiateContributionBody, @Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.initiate({ ...body, founderId: founder.id });
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
    return this.service.handleWebhook(provider, rawBody, headers);
  }
}

import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { IsString } from "class-validator";
import type { Request, Response } from "express";
import {
  FoundersService,
  CreateFounderInput,
  SignUpInput,
  LoginInput,
  EstablishFounderAndFoundationInput,
  DraftPurposeSuggestionInput,
} from "./founders.service";
import { WhatsAppVerificationService } from "./whatsapp/whatsapp-verification.service";
import { resolveFounderFromSession, resolveUserFromSession } from "../../common/auth/current-founder";
import { isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { setSessionCookie, clearSessionCookie, signSessionToken } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

class RequestWhatsAppOtpBody {
  @IsString()
  whatsappNumber!: string;
}

class VerifyWhatsAppOtpBody {
  @IsString()
  code!: string;
}

// @Public() — this whole controller is Founder-Portal self-service,
// authenticated via resolveUserFromSession() (a separate identity type
// from BirrStaff), not unauthenticated. See SessionAuthGuard/Public's
// own comments for why "no BirrStaff session" isn't the same as "no
// auth at all" here.
@Public()
@Controller("founders")
export class FoundersController {
  constructor(
    private readonly service: FoundersService,
    private readonly whatsAppVerification: WhatsAppVerificationService,
  ) {}

  @Post()
  create(@Body() body: CreateFounderInput) {
    return this.service.create(body);
  }

  // Registered before the "sign-up"-shadowing ":id" GET route isn't a
  // concern here (different HTTP method), but verify-email below does
  // share GET with :id, so ordering there matters.
  @Post("sign-up")
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async signUp(@Body() body: SignUpInput, @Res({ passthrough: true }) res: Response) {
    const { userId, emailSent } = await this.service.signUp(body);
    // Always set the session cookie — the account exists either way, and
    // service.signUp() never throws on email delivery failure anymore
    // (see its own comment). emailSent tells the frontend whether to
    // point the founder at "resend the email" right away.
    setSessionCookie(res, signSessionToken(userId));
    return { ok: true, emailSent };
  }

  // Requires a session (set by sign-up above, regardless of whether the
  // original email actually sent) — see FoundersService.resendVerificationEmail's
  // own comment for why there's no unauthenticated version of this.
  @Post("resend-verification-email")
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async resendVerificationEmail(@Req() request: Request) {
    const user = await resolveUserFromSession(request);
    return this.service.resendVerificationEmail(user.id);
  }

  // Brute-force protection on a real credential, not just an OTP — a
  // tighter window than sign-up's since a login attempt is cheaper to
  // script than filling out a whole sign-up form.
  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async login(@Body() body: LoginInput, @Res({ passthrough: true }) res: Response) {
    const { userId } = await this.service.login(body);
    setSessionCookie(res, signSessionToken(userId));
    return { ok: true };
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) res: Response) {
    clearSessionCookie(res);
    return { ok: true };
  }

  // Declared before ":id" — otherwise Nest would match GET /founders/me
  // as findById(id: "me") instead of this route.
  @Get("me")
  async me(@Req() request: Request) {
    // The same birr_session cookie mechanism backs both Founder and
    // BirrStaff identities (see common/auth/current-birr-staff.ts's own
    // comment on this) — without this check, a signed-in Birr staff
    // member browsing the merged app's founder route group would
    // resolve here as "a real user, no founder yet," which the founder
    // AppShell then renders as onboarding-step-1 UI. Same bug class
    // already fixed on WaqfsController/FoundationsController; this route
    // just hadn't been touched by that pass.
    if (await isBirrStaffSession(request)) {
      throw new UnauthorizedException("This session belongs to Birr staff, not a Founder.");
    }
    const user = await resolveUserFromSession(request);
    return this.service.getSessionSummary(user.id);
  }

  @Get("me/onboarding-status")
  async myOnboardingStatus(@Req() request: Request) {
    if (await isBirrStaffSession(request)) {
      throw new UnauthorizedException("This session belongs to Birr staff, not a Founder.");
    }
    const user = await resolveUserFromSession(request);
    return this.service.getOnboardingStatus(user.id);
  }

  // Reachable by any active member (not just the primary contact) — see
  // FoundersService.listMembers's own comment on why seeing who has
  // access is different from being able to change it.
  @Get("me/members")
  async myMembers(@Req() request: Request) {
    if (await isBirrStaffSession(request)) {
      throw new UnauthorizedException("This session belongs to Birr staff, not a Founder.");
    }
    const founder = await resolveFounderFromSession(request);
    return this.service.listMembers(founder.id);
  }

  // Step 2 of onboarding — the merge point: Founder identity +
  // Foundation + an optional logo, submitted together. multipart/form-data
  // via FileInterceptor; no `storage` option configured, so multer
  // defaults to memory storage (file.buffer, never touches disk before
  // LogoStorageService validates it).
  @Post("establish")
  @UseInterceptors(FileInterceptor("logo"))
  async establish(
    @Body() body: EstablishFounderAndFoundationInput,
    @UploadedFile() logo: Express.Multer.File | undefined,
    @Req() request: Request,
  ) {
    const user = await resolveUserFromSession(request);
    return this.service.establishFounderAndFoundation(user.id, body, logo);
  }

  // Rafiq, on demand — a Founder mid-step-2 asking for help drafting a
  // purpose statement. Any signed-in user can call this (no Founder
  // needs to exist yet — that's the whole point, this runs *before*
  // establish() above), same resolveUserFromSession gate as the
  // WhatsApp-verification routes below. Throttled since each call is a
  // real Claude API cost, not just a DB read.
  @Post("onboarding/purpose-suggestion")
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async draftPurposeSuggestion(@Body() body: DraftPurposeSuggestionInput, @Req() request: Request) {
    const user = await resolveUserFromSession(request);
    return this.service.draftPurposeSuggestion(user.id, body);
  }

  // Step 1b of onboarding — WhatsApp verification, alongside email above.
  @Post("whatsapp/request-otp")
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async requestWhatsAppOtp(@Body() body: RequestWhatsAppOtpBody, @Req() request: Request) {
    const user = await resolveUserFromSession(request);
    return this.whatsAppVerification.requestOtp(user.id, body.whatsappNumber);
  }

  @Post("whatsapp/verify-otp")
  async verifyWhatsAppOtp(@Body() body: VerifyWhatsAppOtpBody, @Req() request: Request) {
    const user = await resolveUserFromSession(request);
    return this.whatsAppVerification.verifyOtp(user.id, body.code);
  }

  // Declared before ":id" — otherwise Nest would match GET /founders/verify-email
  // as findById(id: "verify-email") instead of this route. No founderId
  // in the redirect any more (there may not be one yet) — the session
  // cookie set at sign-up already identifies who this is.
  @Get("verify-email")
  async verifyEmail(@Query("token") token: string, @Res() res: Response) {
    const portalUrl = process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000";
    try {
      await this.service.verifyEmail(token);
      res.redirect(302, `${portalUrl}/verified?ok=1`);
    } catch {
      res.redirect(302, `${portalUrl}/verified?ok=0`);
    }
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const founder = await this.service.findById(id);
    if (!founder) throw new NotFoundException(`Founder "${id}" not found.`);
    return founder;
  }
}

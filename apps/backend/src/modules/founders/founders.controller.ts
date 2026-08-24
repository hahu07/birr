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
} from "./founders.service";
import { WhatsAppVerificationService } from "./whatsapp/whatsapp-verification.service";
import { resolveUserFromSession } from "../../common/auth/current-founder";
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
    const { userId } = await this.service.signUp(body);
    setSessionCookie(res, signSessionToken(userId));
    return { ok: true };
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
    const user = await resolveUserFromSession(request);
    return this.service.getSessionSummary(user.id);
  }

  @Get("me/onboarding-status")
  async myOnboardingStatus(@Req() request: Request) {
    const user = await resolveUserFromSession(request);
    return this.service.getOnboardingStatus(user.id);
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

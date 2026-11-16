import { Trimmed } from "../../common/validation/fields";
import { Body, Controller, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsString, Length, MaxLength } from "class-validator";
import type { Request } from "express";
import { Public } from "../../common/guards/public.decorator";
import { GiverWhatsAppService } from "../../common/whatsapp/giver-whatsapp.service";

class RequestWhatsAppCodeBody {
  @Trimmed()
  @IsString()
  @MaxLength(32)
  whatsapp!: string;
}

class ConfirmWhatsAppCodeBody {
  @Trimmed()
  @IsString()
  @MaxLength(32)
  whatsapp!: string;

  @Trimmed()
  @IsString()
  @Length(6, 6)
  code!: string;
}

/**
 * A giver confirming their WhatsApp number before Birr uses it (owner's
 * decision, 2026-11-16). No account: the confirmation hands back a proof
 * that the giving routes check. Throttled here as well as rationed per
 * number and per IP by GiverWhatsAppService, since every code is a paid
 * message to someone's phone.
 */
@Controller("giving/whatsapp")
export class GivingWhatsAppController {
  constructor(private readonly service: GiverWhatsAppService) {}

  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Public()
  @Post("code")
  requestCode(@Body() body: RequestWhatsAppCodeBody, @Req() request: Request) {
    return this.service.requestCode(body.whatsapp, request.ip);
  }

  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @Public()
  @Post("confirm")
  async confirm(@Body() body: ConfirmWhatsAppCodeBody) {
    const { number, proof, expiresAt } = await this.service.confirm(body.whatsapp, body.code);
    return { whatsapp: number, proof, expiresAt };
  }
}

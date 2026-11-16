import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../../common/guards/public.decorator";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { resolveFounderFromSession, resolveUserFromSession } from "../../common/auth/current-founder";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import {
  FounderSuccessionService,
  RecordUnreachableInput,
  ReportUnavailableInput,
  RequestHandoverInput,
  SuccessionNoteInput,
} from "./founder-succession.service";

/**
 * Founder Portal side of primary contact succession: the founder session
 * decides who may ask (the service checks primary contact / member /
 * outgoing contact as each action needs). Nothing here changes who the
 * primary contact is; that's the governed founder.primary_contact_change.
 */
@Public()
@Controller("founder-succession")
export class FounderSuccessionController {
  constructor(private readonly service: FounderSuccessionService) {}

  private async member(request: Request) {
    const [user, founder] = await Promise.all([resolveUserFromSession(request), resolveFounderFromSession(request)]);
    return { userId: user.id, founderId: founder.id };
  }

  @Get()
  async list(@Req() request: Request) {
    return this.service.listForFounder((await this.member(request)).founderId);
  }

  @Post("handover")
  async handover(@Body() body: RequestHandoverInput, @Req() request: Request) {
    return this.service.requestHandover(await this.member(request), body);
  }

  @Post("unavailable")
  async unavailable(@Body() body: ReportUnavailableInput, @Req() request: Request) {
    return this.service.reportUnavailable(await this.member(request), body);
  }

  @Post(":id/object")
  async object(@Param("id") id: string, @Body() body: SuccessionNoteInput, @Req() request: Request) {
    // Only the outgoing contact's own user may object (the service checks).
    return this.service.object(id, (await resolveUserFromSession(request)).id, body);
  }

  @Post(":id/cancel")
  async cancel(@Param("id") id: string, @Req() request: Request) {
    return this.service.cancelByRequester(id, (await resolveUserFromSession(request)).id);
  }
}

/** Ops Console side: seeing cases, recording one for family or an institution, closing one. */
@Controller("staff/founder-succession")
export class FounderSuccessionStaffController {
  constructor(private readonly service: FounderSuccessionService) {}

  @Get()
  @RequiresAccess("founder.succession_view")
  list(@Query("founderId") founderId?: string) {
    return this.service.listForStaff({ founderId });
  }

  @Post()
  @RequiresAccess("founder.succession_record")
  record(@Body() body: RecordUnreachableInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.recordUnreachable(staff.userId, body);
  }

  @Post(":id/close")
  @RequiresAccess("founder.succession_record")
  close(@Param("id") id: string, @Body() body: SuccessionNoteInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.closeByStaff(id, staff.userId, body);
  }
}

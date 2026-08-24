import { Body, Controller, Get, NotFoundException, Param, Post, Res } from "@nestjs/common";
import { IsEmail, IsEnum, IsOptional, IsString } from "class-validator";
import type { Response } from "express";
import { InvitationsService, InviteInput, AcceptInput } from "./invitations.service";
import {
  AuthenticatedBirrStaff,
  CurrentBirrStaff,
} from "../../common/auth/current-birr-staff";
import { setSessionCookie, signSessionToken } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";
import { InviteeKind } from "@birr/db";

class InviteBody {
  @IsEnum(InviteeKind)
  inviteeKind!: InviteeKind;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  founderId?: string;

  // Not @IsEnum here — roleKey is validated against either
  // BirrStaffRole or FounderPermissionLevel depending on inviteeKind
  // (see InvitationsService.invite's own runtime check), which a single
  // static decorator can't express.
  @IsString()
  roleKey!: string;
}

// No @RequiresPermission on invite/revoke — no permission is seeded for
// "who may invite," same bootstrap-scope call as Founders/BirrStaff/Asset
// registration elsewhere in this codebase. @CurrentBirrStaff() still
// resolves who's acting, for the audit trail, without gating eligibility.
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Post()
  invite(@Body() body: InviteBody, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    const input: InviteInput = { ...body, invitedByUserId: staff.userId };
    return this.service.invite(input);
  }

  // Deliberately no guard and no @CurrentBirrStaff() here — this route
  // must be reachable by someone with no account yet. The token itself
  // is the credential (see InvitationsService.accept's comment). @Public()
  // opts it out of the global SessionAuthGuard for the same reason.
  @Post("accept")
  @Public()
  async accept(@Body() body: AcceptInput, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.accept(body);
    setSessionCookie(res, signSessionToken(result.user.id));
    return result;
  }

  @Post(":id/revoke")
  revoke(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.revoke(id, staff.userId);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const invitation = await this.service.findById(id);
    if (!invitation) throw new NotFoundException(`Invitation "${id}" not found.`);
    return invitation;
  }
}

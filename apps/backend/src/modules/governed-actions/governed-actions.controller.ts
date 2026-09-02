import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { IsBoolean, IsObject, IsString } from "class-validator";
import { Request } from "express";
import { GovernedActionStatus } from "@birr/db";
import { GovernedActionsService } from "./governed-actions.service";
import { RequiresPermission } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { hasAnySessionCookie } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

type AuthenticatedRequest = Request & { birrStaff: AuthenticatedBirrStaff };

class ProposeActionBody {
  @IsString()
  permissionKey!: string;

  // Deliberately not a nested DTO — a governed action's payload shape
  // depends entirely on which permissionKey it's for (asset.dispose vs
  // distribution.approve vs ...), so it can't be one static type here.
  // @IsObject() is enough to survive the ValidationPipe's whitelist
  // (undecorated properties get stripped) without constraining its
  // contents — GovernedActionsService's own handler map is what
  // actually knows how to interpret each shape.
  @IsObject()
  payload!: unknown;
}

class DecideActionBody {
  @IsBoolean()
  approve!: boolean;
}

// GET routes are intentionally ungated — same posture as
// AuditLogsController.list(): read-only, no sensitive mutation, no
// permission exists (or is needed) for "who may view governed actions."
@Controller("governed-actions")
export class GovernedActionsController {
  constructor(private readonly service: GovernedActionsService) {}

  // @Public() — also reachable by a signed-in Founder viewing decided
  // (approved/rejected) governance activity on their own waqf, read-only
  // — the passive visibility CLAUDE.md's lifecycle list calls for, that
  // otherwise only existed on the Ops side. Same session-priority
  // pattern as every other founder-scoped list() in this codebase; the
  // staff path below is unchanged.
  @Public()
  @Get()
  async list(
    @Query("status") status: GovernedActionStatus | undefined,
    @Query("waqfId") waqfId: string | undefined,
    @Req() request: Request,
  ) {
    // 2026-08-30 security audit fix — see docs/comprehensive-code-review-prompt.md.
    if (!hasAnySessionCookie(request)) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      if (!waqfId) throw new BadRequestException("Query parameter waqfId is required.");
      const founder = await resolveFounderFromSession(request);
      const actions = await this.service.listDecidedForFounder(waqfId, founder.id);
      if (actions === null) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
      return actions;
    }
    return this.service.list({ status, waqfId });
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const action = await this.service.findById(id);
    if (!action) throw new NotFoundException(`Governed action "${id}" not found.`);
    return action;
  }

  @Post()
  @RequiresPermission("maker")
  propose(@Body() body: ProposeActionBody, @Req() request: AuthenticatedRequest) {
    return this.service.propose({
      permissionKey: body.permissionKey,
      payload: body.payload,
      makerUserId: request.birrStaff.userId,
    });
  }

  @Post(":id/decide")
  @RequiresPermission("checker")
  decide(
    @Param("id") id: string,
    @Body() body: DecideActionBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.decide({
      governedActionId: id,
      approve: body.approve,
      checkerUserId: request.birrStaff.userId,
    });
  }
}

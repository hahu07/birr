import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { IsBoolean, IsObject, IsString } from "class-validator";
import { Request } from "express";
import { GovernedActionStatus } from "@birr/db";
import { GovernedActionsService } from "./governed-actions.service";
import { RequiresPermission } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff } from "../../common/auth/current-birr-staff";

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

  @Get()
  list(
    @Query("status") status?: GovernedActionStatus,
    @Query("waqfId") waqfId?: string,
  ) {
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

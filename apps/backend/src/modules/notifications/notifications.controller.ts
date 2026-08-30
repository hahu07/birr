import { Controller, Get, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { NotificationsService } from "./notifications.service";
import { isBirrStaffSession, resolveBirrStaffFromSession } from "../../common/auth/current-birr-staff";
import { resolveUserFromSession } from "../../common/auth/current-founder";
import { Public } from "../../common/guards/public.decorator";

// @Public() — reachable by both identity types, same "authenticated a
// different way" posture as every other dual-reachable controller in
// this codebase. Always scoped to whoever is actually signed in — a
// staff session's own User row for staff notifications, a founder
// session's own User row for founder notifications; neither can read
// the other's.
@Public()
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async list(@Req() request: Request) {
    const userId = await this.resolveRecipientUserId(request);
    return this.service.list(userId);
  }

  @Post(":id/read")
  async markRead(@Param("id") id: string, @Req() request: Request) {
    const userId = await this.resolveRecipientUserId(request);
    await this.service.markRead(id, userId);
    return { ok: true };
  }

  @Post("read-all")
  async markAllRead(@Req() request: Request) {
    const userId = await this.resolveRecipientUserId(request);
    await this.service.markAllRead(userId);
    return { ok: true };
  }

  private async resolveRecipientUserId(request: Request): Promise<string> {
    if (await isBirrStaffSession(request)) {
      const staff = await resolveBirrStaffFromSession(request);
      return staff.userId;
    }
    const user = await resolveUserFromSession(request);
    return user.id;
  }
}

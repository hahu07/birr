import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query, Req, UnauthorizedException, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { Request } from "express";
import { MessagesService, SendMessageInput } from "./messages.service";
import { MAX_SIZE_BYTES as MAX_ATTACHMENT_SIZE_BYTES } from "./message-attachment-storage.service";
import { isBirrStaffSession, resolveBirrStaffFromSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession, resolveUserFromSession } from "../../common/auth/current-founder";
import { SESSION_COOKIE_NAME } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

// @Public() — dual-reachable, same "authenticated a different way"
// posture as every other dual-session controller in this codebase
// (e.g. AssetsController, NotificationsController). Staff sees any
// Foundation's messages unscoped; a Founder session is scoped to their
// own Foundation via MessagesService.listForFounder's ownership check.
@Public()
@Controller("messages")
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  // maxCount + limits.fileSize match MessageAttachmentStorageService's own
  // caps — without them, multer buffers an arbitrarily large/numerous
  // upload into memory before that service's own checks ever run (2026
  // -08-31 codebase audit finding).
  @Post()
  @UseInterceptors(FilesInterceptor("attachments", 5, { limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES } }))
  async send(
    @Body() body: SendMessageInput,
    @UploadedFiles() attachments: Express.Multer.File[] | undefined,
    @Req() request: Request,
  ) {
    if (await isBirrStaffSession(request)) {
      const staff = await resolveBirrStaffFromSession(request);
      return this.service.send(body, { senderType: "birr_staff", senderUserId: staff.userId }, attachments ?? []);
    }
    const user = await resolveUserFromSession(request);
    const founder = await resolveFounderFromSession(request);
    return this.service.send(
      body,
      { senderType: "founder_user", senderUserId: user.id, founderId: founder.id },
      attachments ?? [],
    );
  }

  // Declared before the bare "list()" route below purely for readability
  // — no actual routing-order concern here, since "inbox" is a literal
  // path segment, not a ":id"-style param that could shadow it.
  @Get("inbox")
  async inbox(@Req() request: Request) {
    if (await isBirrStaffSession(request)) {
      return this.service.inbox();
    }
    const founder = await resolveFounderFromSession(request);
    return this.service.inboxForFounder(founder.id);
  }

  @Get()
  async list(@Query("foundationId") foundationId: string | undefined, @Req() request: Request) {
    if (!foundationId) throw new BadRequestException("Query parameter foundationId is required.");
    // 2026-08-30 security audit fix — see docs/comprehensive-code-review-prompt.md.
    if (!request.cookies?.[SESSION_COOKIE_NAME]) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      const messages = await this.service.listForFounder(foundationId, founder.id);
      if (messages === null) throw new NotFoundException(`Foundation "${foundationId}" not found.`);
      return messages;
    }
    return this.service.list(foundationId);
  }
}

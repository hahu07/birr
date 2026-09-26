import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { IsEmail, IsEnum, IsOptional, IsString } from "class-validator";
import type { Request, Response } from "express";
import { InvitationsService, InviteInput, AcceptInput } from "./invitations.service";
import { isBirrStaffSession, resolveBirrStaffFromSession } from "../../common/auth/current-birr-staff";
import { assertPrimaryContact, resolveFounderFromSession, resolveUserFromSession } from "../../common/auth/current-founder";
import { setSessionCookie, setStaffSessionCookie, signSessionToken, SESSION_COOKIE_NAME, hasAnySessionCookie } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";
import { prisma, InviteeKind } from "@birr/db";

class InviteBody {
  @IsEnum(InviteeKind)
  inviteeKind!: InviteeKind;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  founderId?: string;

  // co_founder only — the EXISTING Foundation to invite a new co-founder
  // into.
  @IsOptional()
  @IsString()
  foundationId?: string;

  // Not @IsEnum here — roleKey is validated against either
  // BirrStaffRole or FounderPermissionLevel depending on inviteeKind
  // (see InvitationsService.invite's own runtime check), which a single
  // static decorator can't express. Unused/ignored for co_founder.
  @IsOptional()
  @IsString()
  roleKey?: string;
}

// No @RequiresPermission on invite/revoke — no permission is seeded for
// "who may invite a founder_user/co_founder," same bootstrap-scope call
// as Founders/Asset registration elsewhere in this codebase.
// resolveBirrStaffFromSession still resolves who's acting, for the audit
// trail, without gating eligibility on those two kinds.
//
// birr_staff invitations are the one exception (2026-09-26 fix): this
// route can't just carry @RequiresStaffRole("platform_admin") the way
// POST /birr-staff does, since it's also the founder_user/co_founder
// entry point above — so the same restriction that route already
// enforces is asserted manually, inside the staff branch below, only
// for inviteeKind === "birr_staff". Found in a codebase review: any
// authenticated staff member, any role, could otherwise invite a new
// staff member with any role — including minting a new platform_admin
// themselves, a real privilege-escalation gap this route's own
// "no @RequiresPermission" posture was never meant to extend to.
//
// invite()/revoke()/list() are @Public() so a Founder session can also
// reach them (same "authenticated a different way" reasoning as every
// other founder-scoped controller) — each branches internally rather
// than being two separate routes, mirroring FoundationsController.create().
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Public()
  @Post()
  async invite(@Body() body: InviteBody, @Req() request: Request) {
    // Deliberately checks the Founder cookie specifically (not
    // hasAnySessionCookie) — this branch's job is "does this request
    // carry a Founder identity to invite on behalf of," which a bare
    // "some session exists" check can't answer. A pure-staff caller (no
    // Founder cookie) correctly falls through to the staff branch below
    // regardless of this condition, same as before the cookie split.
    if (request.cookies?.[SESSION_COOKIE_NAME] && !(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      assertPrimaryContact(founder);
      const user = await resolveUserFromSession(request);

      if (body.inviteeKind === "founder_user") {
        const input: InviteInput = {
          inviteeKind: "founder_user",
          email: body.email,
          // Never the client-supplied body.founderId — forced to the
          // session's own founder, same as FoundationsController.create().
          founderId: founder.id,
          roleKey: body.roleKey ?? "",
          invitedByUserId: user.id,
          invitedByActorType: "founder_user",
          invitedByFounderId: founder.id,
        };
        return this.service.invite(input);
      }
      if (body.inviteeKind === "co_founder") {
        if (!body.foundationId) {
          throw new BadRequestException("foundationId is required.");
        }
        // Verify the calling founder is actually attached to the named
        // Foundation — never trust body.foundationId's membership on its
        // own, same "session is authoritative" posture as
        // FoundationsController.findByIdForFounder. 404, not 403 — don't
        // confirm a Foundation the caller isn't on even exists.
        const membership = await prisma.foundationFounder.findUnique({
          where: { foundationId_founderId: { foundationId: body.foundationId, founderId: founder.id } },
        });
        if (!membership) {
          throw new NotFoundException(`Foundation "${body.foundationId}" not found.`);
        }
        const input: InviteInput = {
          inviteeKind: "co_founder",
          email: body.email,
          foundationId: body.foundationId,
          roleKey: "",
          invitedByUserId: user.id,
          invitedByActorType: "founder_user",
          invitedByFounderId: founder.id,
        };
        return this.service.invite(input);
      }
      throw new BadRequestException("A Founder session can only invite a founder_user or co_founder.");
    }
    const staff = await resolveBirrStaffFromSession(request);
    // Same restriction POST /birr-staff already enforces via
    // @RequiresStaffRole("platform_admin") — see this class's own
    // top comment for why it has to be asserted manually here instead
    // of on the route itself.
    if (body.inviteeKind === "birr_staff" && staff.staffRole !== "platform_admin") {
      throw new ForbiddenException("Only a platform_admin can invite a new Birr staff member.");
    }
    const input: InviteInput = { ...body, roleKey: body.roleKey ?? "", invitedByUserId: staff.userId, invitedByActorType: "birr_staff" };
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
    // A birr_staff invite must log the new staff member into the staff
    // session (STAFF_SESSION_COOKIE_NAME), never the Founder one — see
    // that cookie's own comment. founder_user/co_founder both get the
    // Founder cookie, same as every other founder sign-up/login path.
    if (result.invitation.inviteeKind === "birr_staff") {
      setStaffSessionCookie(res, signSessionToken(result.user.id));
    } else {
      setSessionCookie(res, signSessionToken(result.user.id));
    }
    return result;
  }

  @Public()
  @Post(":id/revoke")
  async revoke(@Param("id") id: string, @Req() request: Request) {
    // Same reasoning as invite() above — deliberately the Founder
    // cookie specifically, not hasAnySessionCookie.
    if (request.cookies?.[SESSION_COOKIE_NAME] && !(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      assertPrimaryContact(founder);
      const user = await resolveUserFromSession(request);
      return this.service.revoke(id, user.id, { type: "founder_user", founderId: founder.id });
    }
    const staff = await resolveBirrStaffFromSession(request);
    return this.service.revoke(id, staff.userId);
  }

  // A Founder session sees only invitations they've sent for their own
  // Foundation, never the platform-wide list Ops Console's Team page
  // uses — same session-priority pattern as every other founder-scoped
  // list() in this codebase.
  @Public()
  @Get()
  async list(@Req() request: Request) {
    // A request with NO session cookie at all must not fall through to
    // the unscoped staff branch below — this exact route leaked every
    // pending invitation's token/roleKey to fully anonymous callers
    // (discovered in the 2026-08-30 security audit), which chained with
    // accept() into unauthenticated BirrStaff account creation. Same
    // explicit no-cookie guard as FoundationDeedsController.findByFoundationId.
    if (!hasAnySessionCookie(request)) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      return this.service.listForFounder(founder.id);
    }
    return this.service.list();
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const invitation = await this.service.findById(id);
    if (!invitation) throw new NotFoundException(`Invitation "${id}" not found.`);
    return invitation;
  }
}

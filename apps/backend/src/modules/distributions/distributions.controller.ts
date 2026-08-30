import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { DistributionsService, CreateDistributionInput } from "./distributions.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff, isBirrStaffSession } from "../../common/auth/current-birr-staff";
import { resolveFounderFromSession } from "../../common/auth/current-founder";
import { SESSION_COOKIE_NAME } from "../../common/auth/session";
import { Public } from "../../common/guards/public.decorator";

@Controller("distributions")
export class DistributionsController {
  constructor(private readonly service: DistributionsService) {}

  // No approve route here, deliberately — distribution.approve is always
  // a governed_actions action (see DistributionsService.approve's
  // comment). It's only ever invoked internally, from
  // GovernedActionsService.decide().

  @Post()
  create(@Body() body: CreateDistributionInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Get()
  list(@Query("waqfId") waqfId?: string) {
    return this.service.list(waqfId);
  }

  // Declared before ":id" — otherwise Nest would match GET
  // /distributions/summary as findById(id: "summary") instead of this
  // route. @Public() — also reachable by a signed-in Founder viewing
  // their own waqf's distribution history (the aggregated shape, never
  // individual distribution rows — see summaryByCauseForFounder's own
  // comment on why that's the PII-safe cut promised in this route's
  // original comment). Same session-priority pattern as
  // AssetsController.list().
  @Public()
  @Get("summary")
  async summary(@Query("waqfId") waqfId: string | undefined, @Req() request: Request) {
    if (!waqfId) throw new BadRequestException("Query parameter waqfId is required.");
    // A request with NO session cookie at all must not fall through to
    // the includeBeneficiaryNames: true staff branch below — this exact
    // route leaked real beneficiary names to fully anonymous callers
    // (2026-08-30 security audit fix — see
    // docs/comprehensive-code-review-prompt.md).
    if (!request.cookies?.[SESSION_COOKIE_NAME]) {
      throw new UnauthorizedException("Not signed in.");
    }
    if (!(await isBirrStaffSession(request))) {
      const founder = await resolveFounderFromSession(request);
      const summary = await this.service.summaryByCauseForFounder(waqfId, founder.id);
      if (summary === null) throw new NotFoundException(`Waqf "${waqfId}" not found.`);
      return summary;
    }
    // includeBeneficiaryNames: true — staff-only branch, see
    // summaryByCause's own comment on why this must never happen on the
    // Founder-scoped branch above. `undefined` for the client param lets
    // its own default (the shared prisma client) apply.
    return this.service.summaryByCause(waqfId, undefined, true);
  }

  // Declared before ":id" — same route-ordering rule as "summary" above.
  // No maker-checker gate: the governance decision already happened at
  // distribution.approve; this is purely payment-mechanics retry
  // against an already-final decision, not a new fiduciary act. No role
  // restriction beyond an authenticated staff session, same posture as
  // create() above.
  @Post(":id/retry-disbursement")
  async retryDisbursement(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    await this.service.retryDisbursement(id, staff.userId);
    return { ok: true };
  }

  // Declared before ":id" — same route-ordering rule as "summary" above.
  // Staff-only by default (no @Public() on this controller or this
  // route — see current-birr-staff.ts's own comment: no @Public() means
  // SessionAuthGuard requires a resolvable BirrStaff session
  // unconditionally).
  @Get("platform-summary")
  platformSummary() {
    return this.service.platformSummary();
  }

  // Founder self-service — @Public() (this controller isn't, by
  // default — see platformSummary's own comment above), same
  // session-resolution pattern as summary()'s founder branch. Paid-only
  // total distributed across every waqf this founder has established,
  // grouped by currency, for the Founder Portal's own Overview page.
  // Declared before ":id" — same route-ordering rule as "summary".
  @Public()
  @Get("founder-summary")
  async founderSummary(@Req() request: Request) {
    const founder = await resolveFounderFromSession(request);
    return this.service.founderSummary(founder.id);
  }

  @Get(":id")
  async findById(@Param("id") id: string) {
    const distribution = await this.service.findById(id);
    if (!distribution) throw new NotFoundException(`Distribution "${id}" not found.`);
    return distribution;
  }
}

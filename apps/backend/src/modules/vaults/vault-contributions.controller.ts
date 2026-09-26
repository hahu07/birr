import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { VaultContributionsService, HoldVaultContributionInput, InitiateVaultContributionInput } from "./vault-contributions.service";
import { Public } from "../../common/guards/public.decorator";
import { RequiresStaffRole } from "../../common/guards/staff-role.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// No class-level @Public() — only initiate()/findById() below need it
// (there's no session of any kind for a public donor, see
// VaultContributionsService.initiate()'s own comment on why there's no
// ownership check the way ContributionsController has for a Founder).
// list()/hold()/release() are staff-only by the default guard, same
// mixed-visibility shape as VaultsController's own listOpen()/
// findBySlug() vs. everything else on that controller.
@Controller("vault-contributions")
export class VaultContributionsController {
  constructor(private readonly service: VaultContributionsService) {}

  // Tighter than the app-wide default (100/min/IP, see app.module.ts's
  // own comment) — this route is @Public() and each call triggers a
  // real Stripe/Paystack/Coinbase API call, so the default limit left
  // it cheap to spam against a live payment provider (found in a
  // codebase audit). Same shape as FoundersController's sign-up
  // override; a higher count than that one since donating more than
  // once from a shared/office IP is a real, legitimate case.
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Public()
  @Post()
  initiate(@Body() body: InitiateVaultContributionInput, @Req() request: Request) {
    return this.service.initiate(body, request.ip);
  }

  // Ops Console listing for one vault — hold()/release() below need
  // something to act on. Staff-only, no dedicated role gate (plain
  // viewing, same posture as e.g. WaqfCausesController's own list()).
  @Get()
  list(@Query("vaultId") vaultId: string) {
    return this.service.listByVault(vaultId);
  }

  // Declared before ":id" below — otherwise Nest would match this as
  // findById(id: "structuring-review") instead. The manual/off-platform
  // AML review CLAUDE.md's own dated note points to (2026-09-15) —
  // same compliance-judgment tier as hold()/release() below.
  @Get("structuring-review")
  @RequiresStaffRole(["compliance_officer", "audit_committee", "board_of_trustees", "platform_admin"])
  structuringReview(@Query("minFraction") minFraction?: string) {
    const parsed = minFraction ? Number(minFraction) : undefined;
    return this.service.getStructuringReview(parsed && !Number.isNaN(parsed) ? parsed : undefined);
  }

  // Polling target for the frontend after redirect/QR display — same
  // posture as GET /contributions/:id.
  @Public()
  @Get(":id")
  async findById(@Param("id") id: string) {
    const contribution = await this.service.findById(id);
    if (!contribution) throw new NotFoundException(`VaultContribution "${id}" not found.`);
    return contribution;
  }

  // Compliance-gated, not a plain-staff action — flagging a confirmed
  // payment for review is a fraud/AML judgment call, same role tier as
  // CounterpartiesController's own compliance-sensitive routes.
  @Post(":id/hold")
  @RequiresStaffRole("compliance_officer")
  hold(@Param("id") id: string, @Body() body: HoldVaultContributionInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.hold(id, body.reason, staff.userId);
  }

  @Post(":id/release")
  @RequiresStaffRole("compliance_officer")
  release(@Param("id") id: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.release(id, staff.userId);
  }
}

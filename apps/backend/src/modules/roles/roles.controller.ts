import { Body, Controller, Get, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { CompleteAccessReviewInput, PreviewPermissionChangesInput, RolesService } from "./roles.service";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";

// Roles & Access — staff managers only since 2026-11-16 (owner's
// decision): roles.view is held by platform_admin, the Board of
// Trustees, Compliance and the Audit Committee. It shows people and
// change history, not only the role structure.
@Controller("roles")
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @Get()
  @RequiresAccess("roles.view")
  overview() {
    return this.service.overview();
  }

  // Read-only: runs the guard rails on a batch before it's proposed.
  @Post("permission-changes/preview")
  @RequiresAccess("roles.view")
  preview(@Body() body: PreviewPermissionChangesInput) {
    return this.service.preview(body.changes);
  }

  @Get("changes")
  @RequiresAccess("roles.view")
  changes(@Query("page") page?: string) {
    return this.service.changes(Math.max(1, Number(page) || 1));
  }

  @Get("export.csv")
  @RequiresAccess("roles.view")
  async export(@CurrentBirrStaff() staff: AuthenticatedBirrStaff, @Res({ passthrough: true }) res: Response) {
    const { filename, csv } = await this.service.exportCsv(staff.userId);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // The Ops Console runs on another origin; without this it can't read the dated filename.
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    return csv;
  }

  @Get("access-reviews")
  @RequiresAccess("roles.view")
  accessReviews() {
    return this.service.accessReviews();
  }

  @Post("access-reviews")
  @RequiresAccess("roles.access_review")
  completeAccessReview(@Body() body: CompleteAccessReviewInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.completeAccessReview(body, staff.userId);
  }
}

import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresAccess } from "../../common/guards/permission.guard";
import { Public } from "../../common/guards/public.decorator";
import { ProgrammeGiftsService } from "../waqf-programmes/programme-gifts.service";
import { ClinicPriceListsService, DraftClinicPriceListInput } from "./clinic-price-lists.service";
import { ClinicClaimsService, CreateClinicClaimInput, LinkClaimZakahInput } from "./clinic-claims.service";
import { ClinicReportsService, RecordClinicReportInput } from "./clinic-reports.service";

// The clinic's own parts of a waqf programme (2026-11-17): its price list,
// monthly claims and monthly figures. Same address scheme as the general
// routes (/waqf-programmes/:id/...). Only clinics exist so far; refusing
// these for other products comes with the product list (step 3).
@Controller("waqf-programmes")
export class ClinicsOpsController {
  constructor(
    private readonly priceLists: ClinicPriceListsService,
    private readonly claims: ClinicClaimsService,
    private readonly reports: ClinicReportsService,
  ) {}

  // The price list and subsidy bands (slice 6), versioned. Approving a
  // version goes through POST /governed-actions (clinic.price_list_approve).
  @Post(":id/price-lists")
  @RequiresAccess("waqf_programme.manage")
  draftPriceList(@Param("id") id: string, @Body() body: DraftClinicPriceListInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.priceLists.draft(id, body, staff.userId);
  }

  @Post(":id/price-lists/:priceListId/discard")
  @RequiresAccess("waqf_programme.manage")
  discardPriceList(@Param("id") id: string, @Param("priceListId") priceListId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.priceLists.discard(id, priceListId, staff.userId);
  }

  @Get(":id/price-lists")
  listPriceLists(@Param("id") id: string) {
    return this.priceLists.list(id);
  }

  // Monthly claims (slice 7). The operator is assigned through POST
  // /governed-actions (clinic.operator_assign); a claim's running fund
  // part is approved and confirmed paid there too (clinic.claim_approve,
  // clinic.claim_mark_paid).
  @Post(":id/claims")
  @RequiresAccess("waqf_programme.manage")
  createClaim(@Param("id") id: string, @Body() body: CreateClinicClaimInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.claims.createClaim(id, body, staff.userId);
  }

  @Post(":id/claims/:claimId/discard")
  @RequiresAccess("waqf_programme.manage")
  discardClaim(@Param("id") id: string, @Param("claimId") claimId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.claims.discardClaim(id, claimId, staff.userId);
  }

  @Post(":id/claims/:claimId/zakah-distribution")
  @RequiresAccess("waqf_programme.manage")
  linkClaimZakah(@Param("id") id: string, @Param("claimId") claimId: string, @Body() body: LinkClaimZakahInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.claims.linkZakah(id, claimId, body, staff.userId);
  }

  @Get(":id/claims")
  listClaims(@Param("id") id: string) {
    return this.claims.listClaims(id);
  }

  @Get(":id/claims/:claimId/lines")
  claimLines(@Param("id") id: string, @Param("claimId") claimId: string) {
    return this.claims.claimLines(id, claimId);
  }

  // Monthly figures (slice 8): recorded by one person, published on the
  // public page by another.
  @Post(":id/reports")
  @RequiresAccess("clinic.report_record")
  recordReport(@Param("id") id: string, @Body() body: RecordClinicReportInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.reports.record(id, body, staff.userId);
  }

  @Post(":id/reports/:reportId/publish")
  @RequiresAccess("clinic.report_publish")
  publishReport(@Param("id") id: string, @Param("reportId") reportId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.reports.publish(id, reportId, staff.userId);
  }

  @Post(":id/reports/:reportId/discard")
  @RequiresAccess("clinic.report_record")
  discardReport(@Param("id") id: string, @Param("reportId") reportId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.reports.discard(id, reportId, staff.userId);
  }

  @Get(":id/reports")
  listReports(@Param("id") id: string) {
    return this.reports.list(id);
  }
}

// The public clinic pages' data (/clinics on the web): the list of clinics,
// and each one's report.
@Controller("clinics")
export class ClinicsPublicController {
  constructor(
    private readonly gifts: ProgrammeGiftsService,
    private readonly reports: ClinicReportsService,
  ) {}

  @Public()
  @Get()
  list() {
    return this.gifts.publicProgrammes("clinic");
  }

  // The endowment, running fund and zakah shown separately, published
  // monthly figures and targets (slice 8).
  @Public()
  @Get(":slug/report")
  report(@Param("slug") slug: string) {
    return this.reports.publicReport(slug);
  }
}

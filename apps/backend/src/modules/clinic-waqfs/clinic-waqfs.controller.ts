import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import {
  ClinicWaqfsService,
  CreateClinicWaqfInput,
  DraftClinicDeedInput,
  UpdateClinicWaqfInput,
} from "./clinic-waqfs.service";
import { ClinicLedgerService } from "./clinic-ledger.service";
import { ClinicGiftsService } from "./clinic-gifts.service";
import { ClinicAssetsService, RecordClinicAssetInput, UpdateClinicAssetCareInput } from "./clinic-assets.service";
import { ClinicSpendingService, CreateClinicSpendInput, ProposeClinicWorksInput } from "./clinic-spending.service";
import {
  ClinicInvestmentsService,
  CreateClinicInvestmentInput,
  PlaceClinicInvestmentInput,
  RecordClinicInvestmentIncomeInput,
  RecordClinicInvestmentReturnInput,
  ScreenClinicInvestmentInput,
} from "./clinic-investments.service";
import { ClinicPriceListsService, DraftClinicPriceListInput } from "./clinic-price-lists.service";
import { ClinicClaimsService, CreateClinicClaimInput, LinkClaimZakahInput } from "./clinic-claims.service";
import { ClinicReportsService, RecordClinicReportInput } from "./clinic-reports.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresAccess } from "../../common/guards/permission.guard";

// Staff only: no @Public() route here. Approving a deed version and
// establishing a clinic waqf go through POST /governed-actions
// (clinic_waqf.deed_approve, clinic_waqf.establish), never a route of
// their own.
@Controller("clinic-waqfs")
export class ClinicWaqfsController {
  constructor(
    private readonly service: ClinicWaqfsService,
    private readonly ledger: ClinicLedgerService,
    private readonly gifts: ClinicGiftsService,
    private readonly assets: ClinicAssetsService,
    private readonly spending: ClinicSpendingService,
    private readonly investments: ClinicInvestmentsService,
    private readonly priceLists: ClinicPriceListsService,
    private readonly claims: ClinicClaimsService,
    private readonly reports: ClinicReportsService,
  ) {}

  @Post()
  @RequiresAccess("clinic_waqf.manage")
  create(@Body() body: CreateClinicWaqfInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Put(":id")
  @RequiresAccess("clinic_waqf.manage")
  update(@Param("id") id: string, @Body() body: UpdateClinicWaqfInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.update(id, body, staff.userId);
  }

  @Post(":id/deeds")
  @RequiresAccess("clinic_waqf.manage")
  draftDeed(@Param("id") id: string, @Body() body: DraftClinicDeedInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.draftDeed(id, body, staff.userId);
  }

  @Post(":id/deeds/:deedId/discard")
  @RequiresAccess("clinic_waqf.manage")
  discardDeed(@Param("id") id: string, @Param("deedId") deedId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.discardDeed(id, deedId, staff.userId);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":id/deed-template")
  deedTemplate(@Param("id") id: string) {
    return this.service.deedTemplate(id);
  }

  @Get(":id/ledger")
  balances(@Param("id") id: string, @Query("currency") currency?: string) {
    return this.ledger.balances(id, currency || "NGN");
  }

  // The asset register (slice 5a). Adding one to the endowment and
  // disposing of one go through POST /governed-actions
  // (clinic_waqf.asset_add, clinic_waqf.asset_dispose).
  @Post(":id/assets")
  @RequiresAccess("clinic_waqf.manage")
  recordAsset(@Param("id") id: string, @Body() body: RecordClinicAssetInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.assets.record(id, body, staff.userId);
  }

  @Put(":id/assets/:assetId")
  @RequiresAccess("clinic_waqf.manage")
  updateAssetCare(
    @Param("id") id: string,
    @Param("assetId") assetId: string,
    @Body() body: UpdateClinicAssetCareInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.assets.updateCare(id, assetId, body, staff.userId);
  }

  @Get(":id/assets")
  listAssets(@Param("id") id: string) {
    return this.assets.list(id);
  }

  // Endowment spending (slice 5b). Approving a works project or a payment,
  // and confirming a payment was made, go through POST /governed-actions.
  @Post(":id/works")
  @RequiresAccess("clinic_waqf.manage")
  proposeWorks(@Param("id") id: string, @Body() body: ProposeClinicWorksInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.spending.proposeWorks(id, body, staff.userId);
  }

  @Get(":id/works")
  listWorks(@Param("id") id: string) {
    return this.spending.listWorks(id);
  }

  @Post(":id/spends")
  @RequiresAccess("clinic_waqf.manage")
  createSpend(@Param("id") id: string, @Body() body: CreateClinicSpendInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.spending.createSpend(id, body, staff.userId);
  }

  @Get(":id/spends")
  listSpends(@Param("id") id: string) {
    return this.spending.listSpends(id);
  }

  // Investments (slice 5c). Placing one is an endowment payment, approved
  // and confirmed through POST /governed-actions like any other.
  @Post(":id/investments")
  @RequiresAccess("clinic_waqf.investment_manage")
  createInvestment(@Param("id") id: string, @Body() body: CreateClinicInvestmentInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.investments.create(id, body, staff.userId);
  }

  @Post(":id/investments/:investmentId/shariah")
  @RequiresAccess("clinic_waqf.investment_shariah_screen")
  screenInvestment(
    @Param("id") id: string,
    @Param("investmentId") investmentId: string,
    @Body() body: ScreenClinicInvestmentInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.investments.screen(id, investmentId, body, staff.userId);
  }

  @Post(":id/investments/:investmentId/placement")
  @RequiresAccess("clinic_waqf.investment_manage")
  placeInvestment(
    @Param("id") id: string,
    @Param("investmentId") investmentId: string,
    @Body() body: PlaceClinicInvestmentInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.investments.proposePlacement(id, investmentId, body, staff.userId);
  }

  @Post(":id/investments/:investmentId/income")
  @RequiresAccess("clinic_waqf.investment_income_record")
  recordInvestmentIncome(
    @Param("id") id: string,
    @Param("investmentId") investmentId: string,
    @Body() body: RecordClinicInvestmentIncomeInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.investments.recordIncome(id, investmentId, body, staff.userId);
  }

  @Post(":id/investments/:investmentId/return")
  @RequiresAccess("clinic_waqf.investment_manage")
  recordInvestmentReturn(
    @Param("id") id: string,
    @Param("investmentId") investmentId: string,
    @Body() body: RecordClinicInvestmentReturnInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.investments.recordReturn(id, investmentId, body, staff.userId);
  }

  @Get(":id/investments")
  listInvestments(@Param("id") id: string) {
    return this.investments.list(id);
  }

  // The price list and subsidy bands (slice 6), versioned. Approving a
  // version goes through POST /governed-actions (clinic_waqf.price_list_approve).
  @Post(":id/price-lists")
  @RequiresAccess("clinic_waqf.manage")
  draftPriceList(@Param("id") id: string, @Body() body: DraftClinicPriceListInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.priceLists.draft(id, body, staff.userId);
  }

  @Post(":id/price-lists/:priceListId/discard")
  @RequiresAccess("clinic_waqf.manage")
  discardPriceList(@Param("id") id: string, @Param("priceListId") priceListId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.priceLists.discard(id, priceListId, staff.userId);
  }

  @Get(":id/price-lists")
  listPriceLists(@Param("id") id: string) {
    return this.priceLists.list(id);
  }

  // Monthly claims (slice 7). The operator is assigned through POST
  // /governed-actions (clinic_waqf.operator_assign); a claim's running fund
  // part is approved and confirmed paid there too (clinic_waqf.claim_approve,
  // clinic_waqf.claim_mark_paid).
  @Post(":id/claims")
  @RequiresAccess("clinic_waqf.manage")
  createClaim(@Param("id") id: string, @Body() body: CreateClinicClaimInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.claims.createClaim(id, body, staff.userId);
  }

  @Post(":id/claims/:claimId/discard")
  @RequiresAccess("clinic_waqf.manage")
  discardClaim(@Param("id") id: string, @Param("claimId") claimId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.claims.discardClaim(id, claimId, staff.userId);
  }

  @Post(":id/claims/:claimId/zakah-distribution")
  @RequiresAccess("clinic_waqf.manage")
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
  @RequiresAccess("clinic_waqf.report_record")
  recordReport(@Param("id") id: string, @Body() body: RecordClinicReportInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.reports.record(id, body, staff.userId);
  }

  @Post(":id/reports/:reportId/publish")
  @RequiresAccess("clinic_waqf.report_publish")
  publishReport(@Param("id") id: string, @Param("reportId") reportId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.reports.publish(id, reportId, staff.userId);
  }

  @Post(":id/reports/:reportId/discard")
  @RequiresAccess("clinic_waqf.report_record")
  discardReport(@Param("id") id: string, @Param("reportId") reportId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.reports.discard(id, reportId, staff.userId);
  }

  @Get(":id/reports")
  listReports(@Param("id") id: string) {
    return this.reports.list(id);
  }

  @Get(":id/gifts")
  listGifts(@Param("id") id: string) {
    return this.gifts.listForClinic(id);
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.service.findById(id);
  }
}

import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import {
  WaqfProgrammesService,
  CreateWaqfProgrammeInput,
  DraftProgrammeDeedInput,
  ListWaqfProgrammesQuery,
  UpdateWaqfProgrammeInput,
} from "./waqf-programmes.service";
import { ProgrammeLedgerService } from "./programme-ledger.service";
import { ProgrammeGiftsService } from "./programme-gifts.service";
import { ProgrammeAssetsService, RecordProgrammeAssetInput, UpdateProgrammeAssetCareInput } from "./programme-assets.service";
import { ProgrammeSpendingService, CreateProgrammeSpendInput, ProposeProgrammeWorksInput } from "./programme-spending.service";
import {
  ProgrammeInvestmentsService,
  CreateProgrammeInvestmentInput,
  PlaceProgrammeInvestmentInput,
  RecordProgrammeInvestmentIncomeInput,
  RecordProgrammeInvestmentReturnInput,
  ScreenProgrammeInvestmentInput,
} from "./programme-investments.service";
import { AuthenticatedBirrStaff, CurrentBirrStaff } from "../../common/auth/current-birr-staff";
import { RequiresAccess } from "../../common/guards/permission.guard";

// Staff only: no @Public() route here. Approving a deed version and
// establishing a clinic waqf go through POST /governed-actions
// (waqf_programme.deed_approve, waqf_programme.establish), never a route of
// their own.
@Controller("waqf-programmes")
export class WaqfProgrammesController {
  constructor(
    private readonly service: WaqfProgrammesService,
    private readonly ledger: ProgrammeLedgerService,
    private readonly gifts: ProgrammeGiftsService,
    private readonly assets: ProgrammeAssetsService,
    private readonly spending: ProgrammeSpendingService,
    private readonly investments: ProgrammeInvestmentsService,
  ) {}

  @Post()
  @RequiresAccess("waqf_programme.manage")
  create(@Body() body: CreateWaqfProgrammeInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.create(body, staff.userId);
  }

  @Put(":id")
  @RequiresAccess("waqf_programme.manage")
  update(@Param("id") id: string, @Body() body: UpdateWaqfProgrammeInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.update(id, body, staff.userId);
  }

  @Post(":id/deeds")
  @RequiresAccess("waqf_programme.manage")
  draftDeed(@Param("id") id: string, @Body() body: DraftProgrammeDeedInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.draftDeed(id, body, staff.userId);
  }

  @Post(":id/deeds/:deedId/discard")
  @RequiresAccess("waqf_programme.manage")
  discardDeed(@Param("id") id: string, @Param("deedId") deedId: string, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.service.discardDeed(id, deedId, staff.userId);
  }

  // Filtered by product, cause and status (Ops Console → Waqf Programmes).
  @Get()
  list(@Query() query: ListWaqfProgrammesQuery) {
    return this.service.list(query);
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
  // (waqf_programme.asset_add, waqf_programme.asset_dispose).
  @Post(":id/assets")
  @RequiresAccess("waqf_programme.manage")
  recordAsset(@Param("id") id: string, @Body() body: RecordProgrammeAssetInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.assets.record(id, body, staff.userId);
  }

  @Put(":id/assets/:assetId")
  @RequiresAccess("waqf_programme.manage")
  updateAssetCare(
    @Param("id") id: string,
    @Param("assetId") assetId: string,
    @Body() body: UpdateProgrammeAssetCareInput,
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
  @RequiresAccess("waqf_programme.manage")
  proposeWorks(@Param("id") id: string, @Body() body: ProposeProgrammeWorksInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.spending.proposeWorks(id, body, staff.userId);
  }

  @Get(":id/works")
  listWorks(@Param("id") id: string) {
    return this.spending.listWorks(id);
  }

  @Post(":id/spends")
  @RequiresAccess("waqf_programme.manage")
  createSpend(@Param("id") id: string, @Body() body: CreateProgrammeSpendInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.spending.createSpend(id, body, staff.userId);
  }

  @Get(":id/spends")
  listSpends(@Param("id") id: string) {
    return this.spending.listSpends(id);
  }

  // Investments (slice 5c). Placing one is an endowment payment, approved
  // and confirmed through POST /governed-actions like any other.
  @Post(":id/investments")
  @RequiresAccess("waqf_programme.investment_manage")
  createInvestment(@Param("id") id: string, @Body() body: CreateProgrammeInvestmentInput, @CurrentBirrStaff() staff: AuthenticatedBirrStaff) {
    return this.investments.create(id, body, staff.userId);
  }

  @Post(":id/investments/:investmentId/shariah")
  @RequiresAccess("waqf_programme.investment_shariah_screen")
  screenInvestment(
    @Param("id") id: string,
    @Param("investmentId") investmentId: string,
    @Body() body: ScreenProgrammeInvestmentInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.investments.screen(id, investmentId, body, staff.userId);
  }

  @Post(":id/investments/:investmentId/placement")
  @RequiresAccess("waqf_programme.investment_manage")
  placeInvestment(
    @Param("id") id: string,
    @Param("investmentId") investmentId: string,
    @Body() body: PlaceProgrammeInvestmentInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.investments.proposePlacement(id, investmentId, body, staff.userId);
  }

  @Post(":id/investments/:investmentId/income")
  @RequiresAccess("waqf_programme.investment_income_record")
  recordInvestmentIncome(
    @Param("id") id: string,
    @Param("investmentId") investmentId: string,
    @Body() body: RecordProgrammeInvestmentIncomeInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.investments.recordIncome(id, investmentId, body, staff.userId);
  }

  @Post(":id/investments/:investmentId/return")
  @RequiresAccess("waqf_programme.investment_manage")
  recordInvestmentReturn(
    @Param("id") id: string,
    @Param("investmentId") investmentId: string,
    @Body() body: RecordProgrammeInvestmentReturnInput,
    @CurrentBirrStaff() staff: AuthenticatedBirrStaff,
  ) {
    return this.investments.recordReturn(id, investmentId, body, staff.userId);
  }

  @Get(":id/investments")
  listInvestments(@Param("id") id: string) {
    return this.investments.list(id);
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

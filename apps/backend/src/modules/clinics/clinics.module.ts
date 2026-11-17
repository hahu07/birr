import { Module } from "@nestjs/common";
import { WaqfProgrammesModule } from "../waqf-programmes/waqf-programmes.module";
import { ClinicsOpsController, ClinicsPublicController } from "./clinics.controller";
import { ClinicPriceListsService } from "./clinic-price-lists.service";
import { ClinicClaimsService } from "./clinic-claims.service";
import { ClinicReportsService } from "./clinic-reports.service";

// The clinic product's own parts (2026-11-17): price lists, operator and
// monthly claims, monthly figures and the public report. The general parts
// (the programme, its deed, pots, gifts, assets, spending, investments,
// reserve) are in WaqfProgrammesModule.
@Module({
  imports: [WaqfProgrammesModule],
  controllers: [ClinicsOpsController, ClinicsPublicController],
  providers: [ClinicPriceListsService, ClinicClaimsService, ClinicReportsService],
  exports: [ClinicPriceListsService, ClinicClaimsService],
})
export class ClinicsModule {}

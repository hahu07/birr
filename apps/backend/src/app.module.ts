import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
// From @sentry/nestjs/setup specifically, not the package's main
// entrypoint — see instrument.ts's own comment on why import order/
// source matters for this SDK's auto-instrumentation.
import { SentryGlobalFilter } from "@sentry/nestjs/setup";
import { FoundersModule } from "./modules/founders/founders.module";
import { FoundationsModule } from "./modules/foundations/foundations.module";
import { BirrStaffModule } from "./modules/birr-staff/birr-staff.module";
import { WaqfsModule } from "./modules/waqfs/waqfs.module";
import { WaqfCausesModule } from "./modules/waqf-causes/waqf-causes.module";
import { CauseCategoriesModule } from "./modules/cause-categories/cause-categories.module";
import { CauseCategorySuggestionsModule } from "./modules/cause-category-suggestions/cause-category-suggestions.module";
import { CauseImpactUpdatesModule } from "./modules/cause-impact-updates/cause-impact-updates.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { BeneficiariesModule } from "./modules/beneficiaries/beneficiaries.module";
import { FounderRequestsModule } from "./modules/founder-requests/founder-requests.module";
import { InvestmentsModule } from "./modules/investments/investments.module";
import { CounterpartiesModule } from "./modules/counterparties/counterparties.module";
import { WaqfProceedsModule } from "./modules/waqf-proceeds/waqf-proceeds.module";
import { DistributionsModule } from "./modules/distributions/distributions.module";
import { GovernedActionsModule } from "./modules/governed-actions/governed-actions.module";
import { AuditLogsModule } from "./modules/audit-logs/audit-logs.module";
import { AiAgentsModule } from "./modules/ai-agents/ai-agents.module";
import { ConflictOfInterestDeclarationsModule } from "./modules/conflict-of-interest-declarations/conflict-of-interest-declarations.module";
import { WaqfCaseAssignmentsModule } from "./modules/waqf-case-assignments/waqf-case-assignments.module";
import { ComplianceReportsModule } from "./modules/compliance-reports/compliance-reports.module";
import { InvitationsModule } from "./modules/invitations/invitations.module";
import { ContributionsModule } from "./modules/contributions/contributions.module";
import { WaqfDeedsModule } from "./modules/waqf-deeds/waqf-deeds.module";
import { FoundationDeedsModule } from "./modules/foundation-deeds/foundation-deeds.module";
import { PlatformSettingsModule } from "./modules/platform-settings/platform-settings.module";
import { TrusteeLicensesModule } from "./modules/trustee-licenses/trustee-licenses.module";
import { CompliancePolicySetsModule } from "./modules/compliance-policy-sets/compliance-policy-sets.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { WaqfFundingModule } from "./modules/waqf-funding/waqf-funding.module";
import { RolesModule } from "./modules/roles/roles.module";
import { InvestmentPlacementsModule } from "./modules/investment-placements/investment-placements.module";
import { BeneficiaryNominationsModule } from "./modules/beneficiary-nominations/beneficiary-nominations.module";
import { MessagesModule } from "./modules/messages/messages.module";
import { FinancialReportsModule } from "./modules/financial-reports/financial-reports.module";
import { HealthModule } from "./modules/health/health.module";
import { BanksModule } from "./modules/banks/banks.module";
import { VaultsModule } from "./modules/vaults/vaults.module";
import { PermissionGuard } from "./common/guards/permission.guard";
import { StaffRoleGuard } from "./common/guards/staff-role.guard";
import { SessionAuthGuard } from "./common/guards/session-auth.guard";

@Module({
  imports: [
    // Generous global default so it's a no-op for normal API traffic —
    // only routes with their own @Throttle() override (currently just
    // POST /founders/sign-up) get a meaningfully tight limit.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    FoundersModule,
    FoundationsModule,
    BirrStaffModule,
    WaqfsModule,
    WaqfCausesModule,
    CauseCategoriesModule,
    CauseCategorySuggestionsModule,
    CauseImpactUpdatesModule,
    AssetsModule,
    BeneficiariesModule,
    FounderRequestsModule,
    InvestmentsModule,
    CounterpartiesModule,
    WaqfProceedsModule,
    DistributionsModule,
    GovernedActionsModule,
    AuditLogsModule,
    AiAgentsModule,
    ConflictOfInterestDeclarationsModule,
    WaqfCaseAssignmentsModule,
    ComplianceReportsModule,
    InvitationsModule,
    ContributionsModule,
    WaqfDeedsModule,
    FoundationDeedsModule,
    PlatformSettingsModule,
    TrusteeLicensesModule,
    CompliancePolicySetsModule,
    NotificationsModule,
    WaqfFundingModule,
    RolesModule,
    InvestmentPlacementsModule,
    BeneficiaryNominationsModule,
    MessagesModule,
    FinancialReportsModule,
    HealthModule,
    BanksModule,
    VaultsModule,
  ],
  providers: [
    // First in the list — captures unhandled request-path errors for
    // Sentry before AllExceptionsFilter (registered separately in
    // main.ts via useGlobalFilters) formats the response. A no-op
    // reporter, not a no-op filter, when SENTRY_DSN is unset: it still
    // rethrows every exception unchanged either way.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Default-deny floor — must run before PermissionGuard/StaffRoleGuard
    // (Nest runs multiple APP_GUARDs in provider-registration order; all
    // must pass). See SessionAuthGuard's own comment for why this exists
    // as a separate guard rather than folded into the other two.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: StaffRoleGuard },
  ],
})
export class AppModule {}

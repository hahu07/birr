import { Logger } from "@nestjs/common";
import { prisma } from "@birr/db";
import { NotificationsService } from "../notifications/notifications.service";
import { InvestmentTargetsService } from "./investment-targets.service";
import { VaultInvestmentTargetsService } from "../vaults/vault-investment-targets.service";
import { PORTFOLIO_DRIFT_THRESHOLD_PERCENT } from "./investment-drift.constants";

const logger = new Logger("PortfolioDriftScheduler");

/**
 * Same "start simple" posture as trustee-license-expiry-scheduler.ts —
 * a plain setInterval, not a new scheduling dependency, checked once at
 * startup then on a daily-ish tick. This is the one place an
 * Investment/VaultInvestment's current mix is compared against its
 * staff-set target for a "who needs to know" question — the on-demand
 * GET routes answer a different question ("what does it look like right
 * now"), reusing the same computeDrift()/InvestmentTargetsService.
 *
 * Known limitation, accepted rather than engineered around for this
 * pass, same tradeoff trustee-license-expiry-scheduler.ts already
 * makes: there's no "already notified for this one" tracking, so a fund
 * sitting outside its target keeps getting re-notified on every tick
 * until someone updates its investments or its targets. Noisy in
 * exchange for zero added state.
 */
export function startPortfolioDriftScheduler(
  investmentTargetsService: InvestmentTargetsService,
  vaultInvestmentTargetsService: VaultInvestmentTargetsService,
  notificationsService: NotificationsService,
): void {
  const intervalMs = Number(process.env.PORTFOLIO_DRIFT_CHECK_INTERVAL_MS ?? 24 * 60 * 60 * 1000);

  const tick = () => {
    checkPortfolioDrift(investmentTargetsService, vaultInvestmentTargetsService, notificationsService).catch((err) => {
      logger.error("Portfolio drift check failed:", err instanceof Error ? err.stack : String(err));
    });
  };

  tick();
  setInterval(tick, intervalMs);
}

async function checkPortfolioDrift(
  investmentTargetsService: InvestmentTargetsService,
  vaultInvestmentTargetsService: VaultInvestmentTargetsService,
  notificationsService: NotificationsService,
): Promise<void> {
  await checkWaqfDrift(investmentTargetsService, notificationsService);
  await checkVaultDrift(vaultInvestmentTargetsService, notificationsService);
}

async function checkWaqfDrift(
  investmentTargetsService: InvestmentTargetsService,
  notificationsService: NotificationsService,
): Promise<void> {
  // Only funds with at least one target row set — see InvestmentTarget's
  // own schema comment on why a fund with zero targets has nothing to
  // drift from.
  const fundsWithTargets = await prisma.investmentTarget.findMany({
    select: { waqfId: true },
    distinct: ["waqfId"],
  });

  for (const { waqfId } of fundsWithTargets) {
    const report = await investmentTargetsService.computeDrift(waqfId);
    if (!report.anyDrifted) continue;

    const waqf = await prisma.waqf.findUnique({ where: { id: waqfId }, select: { name: true } });
    // The specific staff member(s) actually responsible for this fund's
    // investments, not every investment officer platform-wide.
    const recipients = await prisma.birrStaff.findMany({
      where: {
        status: "active",
        caseAssignments: { some: { waqfId, assignmentRole: "investment_officer", status: "active" } },
      },
      select: { userId: true },
    });

    const drifted = report.breakdown.filter((b) => b.drifted);
    const summary = drifted.map((b) => `${b.instrumentType} (${b.driftPercentagePoints}pp)`).join(", ");
    const title = `Portfolio drift detected${waqf ? ` — ${waqf.name}` : ""}`;
    const body = `Actual investment mix has drifted more than ${PORTFOLIO_DRIFT_THRESHOLD_PERCENT} percentage points from target: ${summary}.`;

    await Promise.all(
      recipients.map((r) =>
        notificationsService.notify({
          recipientType: "birr_staff",
          recipientUserId: r.userId,
          type: "portfolio.drift_detected",
          title,
          body,
          linkUrl: `/ops/waqfs/${waqfId}`,
          relatedEntityType: "Waqf",
          relatedEntityId: waqfId,
        }),
      ),
    );
  }
}

async function checkVaultDrift(
  vaultInvestmentTargetsService: VaultInvestmentTargetsService,
  notificationsService: NotificationsService,
): Promise<void> {
  const vaultsWithTargets = await prisma.vaultInvestmentTarget.findMany({
    select: { vaultId: true },
    distinct: ["vaultId"],
  });

  if (vaultsWithTargets.length === 0) return;

  // No Vault-scoped staff-assignment model exists anywhere in this
  // schema (only WaqfCaseAssignment, always keyed to a waqfId) — falls
  // back to every active investment_committee member platform-wide,
  // same shape as the license scheduler's own platform_admin fallback.
  // investment_committee is also the role that sets these targets in
  // the first place.
  const recipients = await prisma.birrStaff.findMany({
    where: { staffRole: "investment_committee", status: "active" },
    select: { userId: true },
  });
  if (recipients.length === 0) return;

  for (const { vaultId } of vaultsWithTargets) {
    const report = await vaultInvestmentTargetsService.computeDrift(vaultId);
    if (!report.anyDrifted) continue;

    const vault = await prisma.vault.findUnique({ where: { id: vaultId }, select: { name: true } });
    const drifted = report.breakdown.filter((b) => b.drifted);
    const summary = drifted.map((b) => `${b.instrumentType} (${b.driftPercentagePoints}pp)`).join(", ");
    const title = `Portfolio drift detected${vault ? ` — ${vault.name}` : ""}`;
    const body = `Actual investment mix has drifted more than ${PORTFOLIO_DRIFT_THRESHOLD_PERCENT} percentage points from target: ${summary}.`;

    await Promise.all(
      recipients.map((r) =>
        notificationsService.notify({
          recipientType: "birr_staff",
          recipientUserId: r.userId,
          type: "portfolio.drift_detected",
          title,
          body,
          linkUrl: `/ops/vaults/${vaultId}`,
          relatedEntityType: "Vault",
          relatedEntityId: vaultId,
        }),
      ),
    );
  }
}

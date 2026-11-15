import { Logger } from "@nestjs/common";
import type { PaymentReconciliationService } from "./payment-reconciliation.service";

const logger = new Logger("PaymentReconciliationScheduler");

/**
 * Checks hourly whether yesterday (Lagos time) has been reconciled with
 * Paystack, and runs it after 02:00 if not. Plain setInterval, the same
 * "start simple" posture as the other schedulers. Safe on several
 * servers: a day's scheduled run is claimed by a unique index.
 */
export function startPaymentReconciliationScheduler(service: PaymentReconciliationService): void {
  const intervalMs = Number(process.env.PAYMENT_RECONCILIATION_TICK_MS ?? 60 * 60 * 1000);
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    service
      .runScheduled()
      .catch((err) => logger.error("Reconciliation check failed:", err instanceof Error ? err.stack : String(err)))
      .finally(() => {
        running = false;
      });
  };
  tick();
  setInterval(tick, intervalMs);
}

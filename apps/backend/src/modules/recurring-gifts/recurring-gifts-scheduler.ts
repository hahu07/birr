import { Logger } from "@nestjs/common";
import type { RecurringGiftsService } from "./recurring-gifts.service";

const logger = new Logger("RecurringGiftsScheduler");

/**
 * Runs monthly giving (RecurringGiftsService.tick) on a plain interval,
 * the same "start simple" posture as the trustee-licence scheduler.
 * Hourly by default; charges are due at 09:00 Lagos, so a gift is charged
 * within the hour. Safe to run on more than one server: each gift is
 * claimed before it's charged, and the database allows one non-failed
 * payment per gift per month.
 */
export function startRecurringGiftsScheduler(service: RecurringGiftsService): void {
  const intervalMs = Number(process.env.RECURRING_GIFTS_TICK_MS ?? 60 * 60 * 1000);
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    service
      .tick()
      .catch((err) => logger.error("Monthly giving run failed:", err instanceof Error ? err.stack : String(err)))
      .finally(() => {
        running = false;
      });
  };
  tick();
  setInterval(tick, intervalMs);
}

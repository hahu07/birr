import { runMonitoredJob } from "../../common/jobs/job-monitor";
import type { RecurringGiftsService } from "./recurring-gifts.service";


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
    // Recorded and alerted on by the job monitor (2026-11-16), never thrown.
    void runMonitoredJob("monthly_giving", () => service.tick())
      .finally(() => {
        running = false;
      });
  };
  tick();
  setInterval(tick, intervalMs);
}

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SystemHealthPage from "./page";

vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn(), apiFetchJson: vi.fn() }));
import { apiFetchJson } from "../../../lib/api";

const mocked = vi.mocked(apiFetchJson);
const job = (over: Record<string, unknown>) => ({
  job: "monthly_giving", label: "Monthly giving: charges, retries and reminders", everyMs: 3_600_000, external: false, public: true,
  lastRun: { status: "succeeded", startedAt: "2026-11-16T09:00:00.000Z", finishedAt: "2026-11-16T09:00:05.000Z", error: null },
  lastSuccessAt: "2026-11-16T09:00:00.000Z", lastFailure: null, dueBy: "2026-11-16T12:00:00.000Z", overdue: false, failing: false, ...over,
});

describe("Ops: System health", () => {
  beforeEach(() => mocked.mockReset());

  test("says what needs attention: a failed run with its error, and a backup that never ran", async () => {
    mocked.mockResolvedValue({
      checkedAt: "2026-11-16T10:00:00.000Z",
      jobs: [
        job({ lastRun: { status: "failed", startedAt: "2026-11-16T09:00:00.000Z", finishedAt: null, error: "Paystack timed out" }, failing: true }),
        job({ job: "database_backup", label: "Database backup (scripts/backup-postgres.sh)", everyMs: 86_400_000, external: true, lastRun: null, lastSuccessAt: null, dueBy: null, overdue: true }),
        job({ job: "portfolio_drift", label: "Portfolio drift check", everyMs: 86_400_000 }),
      ],
      recentFailures: [{ id: "r1", job: "monthly_giving", startedAt: "2026-11-16T09:00:00.000Z", error: "Paystack timed out" }],
    });
    render(<SystemHealthPage />);
    expect(await screen.findByText("2 jobs need attention")).toBeInTheDocument();
    expect(screen.getByText("Last run failed")).toBeInTheDocument();
    expect(screen.getByText("Never succeeded")).toBeInTheDocument();
    expect(screen.getByText("On time")).toBeInTheDocument();
    expect(screen.getAllByText("Paystack timed out")).toHaveLength(2);
  });

  test("all clear when every job is on time", async () => {
    mocked.mockResolvedValue({ checkedAt: "2026-11-16T10:00:00.000Z", jobs: [job({})], recentFailures: [] });
    render(<SystemHealthPage />);
    expect(await screen.findByText("Everything is running")).toBeInTheDocument();
  });
});

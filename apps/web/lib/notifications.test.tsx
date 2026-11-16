import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell } from "@birr/ui";
import { useNotifications } from "./notifications";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

import { ApiError, apiFetchJson } from "./api";

const mocked = vi.mocked(apiFetchJson);

describe("notifications that fail to load", () => {
  beforeEach(() => mocked.mockReset());

  test("the hook reports the failure, and clears it once a load works", async () => {
    mocked.mockRejectedValueOnce(new ApiError("Service unavailable.", 503));
    const { result } = renderHook(() => useNotifications(true));
    await waitFor(() => expect(result.current.error).toBe("Service unavailable."));
    expect(result.current.unreadCount).toBe(0);

    mocked.mockResolvedValueOnce([{ id: "n1", title: "Approval needed", body: "", readAt: null, createdAt: "2026-11-16T08:00:00Z" }]);
    await act(() => result.current.refresh());
    expect(result.current.error).toBeNull();
    expect(result.current.unreadCount).toBe(1);
  });

  test("the bell never shows a failure as 'all caught up'", async () => {
    render(
      <NotificationBell notifications={[]} unreadCount={0} error="Service unavailable." onSelect={vi.fn()} onMarkAllRead={vi.fn()} formatTimestamp={(s) => s} />,
    );
    const bell = screen.getByRole("button", { name: "Notifications, couldn't load" });
    await userEvent.click(bell);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load notifications: Service unavailable.");
  });
});

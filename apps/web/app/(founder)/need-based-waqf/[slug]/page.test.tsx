import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import NeedBasedWaqfGivingPage from "./page";
import { apiFetchJson } from "../../../../lib/api";

vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "kano" }) }));
vi.mock("../../../../lib/founder-session", () => ({ useFounderSession: () => ({ founder: null, loading: false }) }));
vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

const mockedFetch = vi.mocked(apiFetchJson);

const terms = (product: "need_based" | "clinic") => ({
  clinic: { name: "Kano Households Waqf", slug: "kano", city: "Kano", description: null, product },
  available: true,
  currency: "NGN",
  minimumAmount: "5000",
  deed: { id: "deed-1", version: 1, text: "Deed of the Kano Households Waqf waqf", textHash: "a".repeat(64) },
});

describe("NeedBasedWaqfGivingPage", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("says support hasn't started, with no figure, and offers the endowment and the spending fund", async () => {
    mockedFetch.mockImplementation(async (path: string) =>
      path.endsWith("/report")
        ? { currency: "NGN", targets: { endowment: null, runningMonthly: null }, endowment: { endowed: "0", cash: "0", invested: "0" }, running: { gifts: "7500", endowmentIncome: "0", receivedThisMonth: "7500", held: "7500" } }
        : terms("need_based"),
    );
    render(<NeedBasedWaqfGivingPage />);
    await waitFor(() => expect(screen.getByText("Kano Households Waqf")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Held for support")).toBeTruthy());
    expect(mockedFetch).toHaveBeenCalledWith("/programme-gifts/programmes/need_based/kano/report");
    expect(mockedFetch).toHaveBeenCalledWith("/programme-gifts/terms/kano");
    expect(screen.getByText("Support hasn't started yet")).toBeTruthy();
    expect(screen.getByText("Endow it")).toBeTruthy();
    expect(screen.getByText("Give to the spending fund")).toBeTruthy();
    expect(screen.queryByText(/running fund/i)).toBeNull();
    expect(screen.getByText(/A waqf for poor households in Kano/).textContent).not.toMatch(/₦/);
  });

  it("doesn't show a clinic at a need-based address", async () => {
    mockedFetch.mockResolvedValue(terms("clinic"));
    render(<NeedBasedWaqfGivingPage />);
    await waitFor(() => expect(screen.getByText("We couldn't find this page.")).toBeTruthy());
    expect(screen.queryByText("Endow it")).toBeNull();
  });
});

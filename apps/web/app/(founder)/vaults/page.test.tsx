import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import VaultsIndexPage from "./page";
import { apiFetchJson } from "../../../lib/api";
import type { Vault } from "../../../lib/types";

// Reveal uses IntersectionObserver, which jsdom doesn't have — same
// pass-through mock ImpactSection.test.tsx already uses. SiteHeader/
// SiteFooter/VaultCard are kept real; nothing about them is relevant to
// the loading/error/empty/data branches this test exercises.
vi.mock("../SiteChrome", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SiteChrome")>();
  return { ...actual, Reveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

vi.mock("../../../lib/api", () => ({ apiFetchJson: vi.fn() }));

const mockedFetch = vi.mocked(apiFetchJson);

function vault(over: Partial<Vault> = {}): Vault {
  return {
    id: "v1",
    name: "Ramadan Relief",
    slug: "ramadan-relief",
    description: null,
    type: "project",
    currency: "NGN",
    additionalCurrencies: [],
    targetAmount: null,
    amountRaised: [],
    jurisdiction: "NG",
    coverImageUrl: null,
    feasibilityReportUrl: null,
    feasibilityReportTitle: null,
    causes: [],
    milestones: [],
    ...over,
  };
}

describe("VaultsIndexPage — loading, error, and empty states stay distinct", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("shows loading skeletons before the fetch resolves, not an empty-state message", async () => {
    mockedFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<VaultsIndexPage />);
    expect(screen.queryByText(/No vaults are open/)).toBeNull();
    expect(screen.queryByText(/Couldn't load open vaults/)).toBeNull();
  });

  it("shows the real empty-state message only on a genuine zero-vault result", async () => {
    mockedFetch.mockResolvedValue([]);
    render(<VaultsIndexPage />);
    await waitFor(() => expect(screen.getByText(/No vaults are open for giving right now/)).toBeTruthy());
    expect(screen.queryByText(/Couldn't load open vaults/)).toBeNull();
  });

  it("shows a distinct error message on a fetch failure — never the empty-state copy", async () => {
    mockedFetch.mockRejectedValue(new Error("network down"));
    render(<VaultsIndexPage />);
    await waitFor(() => expect(screen.getByText(/Couldn't load open vaults/)).toBeTruthy());
    // The regression this guards against: a caught fetch error used to
    // render the exact same "No vaults are open" copy as a real empty
    // result, telling a donor nothing was open when the backend was
    // simply unreachable.
    expect(screen.queryByText(/No vaults are open for giving right now/)).toBeNull();
  });

  it("renders real vault data once the fetch succeeds", async () => {
    mockedFetch.mockResolvedValue([vault()]);
    render(<VaultsIndexPage />);
    await waitFor(() => expect(screen.getByText("Ramadan Relief")).toBeTruthy());
    expect(screen.queryByText(/No vaults are open/)).toBeNull();
    expect(screen.queryByText(/Couldn't load open vaults/)).toBeNull();
  });

  it("retrying after an error re-fetches and clears the error on success", async () => {
    mockedFetch.mockRejectedValueOnce(new Error("first attempt fails"));
    render(<VaultsIndexPage />);
    await waitFor(() => expect(screen.getByText(/Couldn't load open vaults/)).toBeTruthy());

    mockedFetch.mockResolvedValueOnce([vault({ name: "Clean Water" })]);
    screen.getByText("Try again").click();

    await waitFor(() => expect(screen.getByText("Clean Water")).toBeTruthy());
    expect(screen.queryByText(/Couldn't load open vaults/)).toBeNull();
  });
});

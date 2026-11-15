import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import VaultDonationPage from "./page";
import { apiFetchJson, ApiError } from "../../../../lib/api";
import type { Vault } from "../../../../lib/types";

vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "ramadan-relief" }) }));
vi.mock("../../../../lib/funnel-tracking", () => ({ trackFunnelEvent: vi.fn() }));
vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

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

describe("VaultDonationPage — a fetch failure is not the same as a real 404", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    // Both calls in the effect go through the same mocked apiFetchJson —
    // the second (contribution minimums) just needs to not hang.
    mockedFetch.mockImplementation((path: string) => {
      if (path.includes("contribution-minimums")) return Promise.resolve([]);
      return new Promise(() => {}); // overridden per-test for the vault fetch itself
    });
  });

  it("shows loading skeletons before the fetch resolves", async () => {
    render(<VaultDonationPage />);
    expect(screen.queryByText(/isn't open right now/)).toBeNull();
    expect(screen.queryByText(/Couldn't load this vault/)).toBeNull();
  });

  it("shows 'This vault isn't open right now' only for a genuine 404 from our own backend", async () => {
    mockedFetch.mockImplementation((path: string) => {
      if (path.includes("contribution-minimums")) return Promise.resolve([]);
      return Promise.reject(new ApiError('Vault "ramadan-relief" not found.', 404));
    });
    render(<VaultDonationPage />);
    await waitFor(() => expect(screen.getByText("This vault isn't open right now.")).toBeTruthy());
    expect(screen.queryByText(/Couldn't load this vault/)).toBeNull();
  });

  it("shows a distinct 'couldn't load' message for a non-404 failure — never claims the vault is closed", async () => {
    mockedFetch.mockImplementation((path: string) => {
      if (path.includes("contribution-minimums")) return Promise.resolve([]);
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    render(<VaultDonationPage />);
    await waitFor(() => expect(screen.getByText("Couldn't load this vault.")).toBeTruthy());
    // The regression this guards against: a misconfigured
    // NEXT_PUBLIC_BACKEND_URL made every fetch fail, and this exact page
    // told a donor the vault "isn't open right now" — actively
    // misleading, not just an unhelpful empty state.
    expect(screen.queryByText(/isn't open right now/)).toBeNull();
  });

  it("shows a distinct 'couldn't load' message for a non-404 ApiError (e.g. a 500) too", async () => {
    mockedFetch.mockImplementation((path: string) => {
      if (path.includes("contribution-minimums")) return Promise.resolve([]);
      return Promise.reject(new ApiError("Internal server error", 500));
    });
    render(<VaultDonationPage />);
    await waitFor(() => expect(screen.getByText("Couldn't load this vault.")).toBeTruthy());
    expect(screen.queryByText(/isn't open right now/)).toBeNull();
  });

  it("renders the real vault once the fetch succeeds", async () => {
    mockedFetch.mockImplementation((path: string) => {
      if (path.includes("contribution-minimums")) return Promise.resolve([]);
      return Promise.resolve(vault());
    });
    render(<VaultDonationPage />);
    await waitFor(() => expect(screen.getByText("Ramadan Relief")).toBeTruthy());
    expect(screen.queryByText(/isn't open right now/)).toBeNull();
    expect(screen.queryByText(/Couldn't load this vault/)).toBeNull();
  });
});

describe("VaultDonationPage — giving monthly", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedFetch.mockImplementation((path: string) => {
      if (path.includes("contribution-minimums")) return Promise.resolve([{ currency: "NGN", minAmount: "250000" }]);
      if (path === "/vault-contributions") return Promise.resolve({ clientPayload: { checkoutUrl: "https://checkout.test/x" } });
      return Promise.resolve(vault());
    });
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  });

  it("monthly needs an email and sends monthly: true; one-time stays anonymous-friendly", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<VaultDonationPage />);

    const email = await screen.findByLabelText("Email (optional)");
    expect(email).not.toBeRequired();
    await user.click(screen.getByRole("radio", { name: "Monthly" }));
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(screen.getByText(/of every month, starting today/)).toBeTruthy();

    await user.type(screen.getByLabelText(/^Amount/), "250000");
    await user.type(screen.getByLabelText("Email"), "amina@example.com");
    await user.click(screen.getByRole("button", { name: "Set up monthly gift" }));

    await waitFor(() => expect(window.location.href).toBe("https://checkout.test/x"));
    const [, init] = mockedFetch.mock.calls.find(([path]) => path === "/vault-contributions")!;
    expect(JSON.parse(init!.body as string)).toMatchObject({ amount: "250000", currency: "NGN", provider: "paystack", donorEmail: "amina@example.com", monthly: true });
  });

  it("a one-time gift doesn't ask for monthly", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<VaultDonationPage />);
    await user.type(await screen.findByLabelText(/^Amount/), "250000");
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    await waitFor(() => expect(window.location.href).toBe("https://checkout.test/x"));
    const [, init] = mockedFetch.mock.calls.find(([path]) => path === "/vault-contributions")!;
    expect(JSON.parse(init!.body as string)).not.toHaveProperty("monthly");
  });
});

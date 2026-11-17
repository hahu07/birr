import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ClinicsIndexPage from "./page";
import { apiFetchJson } from "../../../lib/api";

// Reveal uses IntersectionObserver, which jsdom doesn't have; the same
// pass-through mock as vaults/page.test.tsx.
vi.mock("../SiteChrome", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SiteChrome")>();
  return { ...actual, Reveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

vi.mock("../../../lib/api", () => ({ apiFetchJson: vi.fn() }));

const mockedFetch = vi.mocked(apiFetchJson);

describe("ClinicsIndexPage", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("lists each clinic with a link to its page, and whether it's taking gifts", async () => {
    mockedFetch.mockResolvedValue([
      { name: "Mother & Child Clinic, Bodija", slug: "bodija", city: "Ibadan", description: "Antenatal care and child health.", available: true },
      { name: "Mother & Child Clinic, Mokola", slug: "mokola", city: "Ibadan", description: null, available: false },
    ]);
    render(<ClinicsIndexPage />);
    await waitFor(() => expect(screen.getByText("Mother & Child Clinic, Bodija")).toBeTruthy());
    expect(screen.getByText("Taking gifts")).toBeTruthy();
    expect(screen.getByText("Opening soon")).toBeTruthy();
    expect(screen.getByText("Mother & Child Clinic, Bodija").closest("a")?.getAttribute("href")).toBe("/clinics/bodija");
    expect(screen.getByText("Mother & Child Clinic, Mokola").closest("a")?.getAttribute("href")).toBe("/clinics/mokola");
  });

  it("says no clinic is open on a genuine empty list", async () => {
    mockedFetch.mockResolvedValue([]);
    render(<ClinicsIndexPage />);
    await waitFor(() => expect(screen.getByText(/No clinic is open yet/)).toBeTruthy());
    expect(screen.queryByText(/Couldn't load the clinics/)).toBeNull();
  });

  it("shows an error, not the empty message, when the fetch fails", async () => {
    mockedFetch.mockRejectedValue(new Error("network"));
    render(<ClinicsIndexPage />);
    await waitFor(() => expect(screen.getByText(/Couldn't load the clinics/)).toBeTruthy());
    expect(screen.queryByText(/No clinic is open yet/)).toBeNull();
  });
});

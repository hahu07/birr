import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import NeedBasedWaqfIndexPage from "./page";
import { apiFetchJson } from "../../../lib/api";

// Reveal uses IntersectionObserver, which jsdom doesn't have.
vi.mock("../SiteChrome", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SiteChrome")>();
  return { ...actual, Reveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

vi.mock("../../../lib/api", () => ({ apiFetchJson: vi.fn() }));

const mockedFetch = vi.mocked(apiFetchJson);

describe("NeedBasedWaqfIndexPage", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("lists the need-based waqfs from their own list, each linking to its page, and says when support starts", async () => {
    mockedFetch.mockResolvedValue([{ name: "Kano Households Waqf", slug: "kano", city: "Kano", description: null, available: true }]);
    render(<NeedBasedWaqfIndexPage />);
    await waitFor(() => expect(screen.getByText("Kano Households Waqf")).toBeTruthy());
    expect(mockedFetch).toHaveBeenCalledWith("/programme-gifts/programmes/need_based");
    expect(screen.getByText("Kano Households Waqf").closest("a")?.getAttribute("href")).toBe("/need-based-waqf/kano");
    expect(screen.getByText(/Support starts once its licensed financing partner and kifayah line are in place/)).toBeTruthy();
  });
});

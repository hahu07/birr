import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import KifayahIndexPage from "./page";
import { apiFetchJson } from "../../../lib/api";

// Reveal uses IntersectionObserver, which jsdom doesn't have.
vi.mock("../SiteChrome", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SiteChrome")>();
  return { ...actual, Reveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

vi.mock("../../../lib/api", () => ({ apiFetchJson: vi.fn() }));

const mockedFetch = vi.mocked(apiFetchJson);

describe("KifayahIndexPage", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("lists Kifayah from its own list, each linking to its page, and says when support starts", async () => {
    mockedFetch.mockResolvedValue([{ name: "Kifayah Oyo", slug: "kifayah", city: "Ibadan", description: null, available: true }]);
    render(<KifayahIndexPage />);
    await waitFor(() => expect(screen.getByText("Kifayah Oyo")).toBeTruthy());
    expect(mockedFetch).toHaveBeenCalledWith("/programme-gifts/programmes/need_based");
    expect(screen.getByText("Kifayah Oyo").closest("a")?.getAttribute("href")).toBe("/kifayah/kifayah");
    expect(screen.getByText(/Support starts once its licensed financing partner and kifayah line are in place/)).toBeTruthy();
  });
});

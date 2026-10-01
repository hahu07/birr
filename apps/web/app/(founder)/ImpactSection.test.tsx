import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FieldPhoto, ImpactSummary } from "../../lib/impact-api";
import { ImpactSection, MARQUEE_MIN_PHOTOS } from "./ImpactSection";

// Reveal uses IntersectionObserver/matchMedia, which jsdom doesn't have; it's
// only a fade-in wrapper, so a pass-through is enough here.
vi.mock("./SiteChrome", () => ({ Reveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

const impact = (over: Partial<ImpactSummary> = {}): ImpactSummary => ({
  giftsReceived: 1234,
  givenByCurrency: [{ currency: "NGN", amount: "141000000" }, { currency: "USD", amount: "200000" }],
  fundsAndCampaigns: 12,
  paidOutByCurrency: [],
  ...over,
});

const photo = (n: number, over: Partial<FieldPhoto> = {}): FieldPhoto => ({
  id: `photo-${n}`,
  imageUrl: `http://x/p${n}.jpg`,
  kind: n % 2 ? "delivery" : "milestone",
  title: `Title ${n}`,
  caption: null,
  vaultName: `Vault ${n}`,
  vaultSlug: `vault-${n}`,
  occurredAt: "2026-09-01T00:00:00.000Z",
  ...over,
});
const photos = (count: number) => Array.from({ length: count }, (_, i) => photo(i + 1));

describe("ImpactSection — numbers", () => {
  it("renders nothing without data", () => {
    const { container } = render(<ImpactSection impact={null} photos={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows each real figure, with other currencies listed beside the lead one, never merged into it", () => {
    render(<ImpactSection impact={impact()} photos={[]} />);
    expect(screen.getByText("1,234")).toBeTruthy();
    expect(screen.getByText("₦141M")).toBeTruthy();
    expect(screen.getByText(/US\$200K/)).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("leaves out a stat with no data (nothing paid out yet) instead of showing a zero", () => {
    const { unmount } = render(<ImpactSection impact={impact()} photos={[]} />);
    expect(screen.queryByText("Paid out to causes")).toBeNull();
    unmount();
    render(<ImpactSection impact={impact({ paidOutByCurrency: [{ currency: "NGN", amount: "5000000" }] })} photos={[]} />);
    expect(screen.getByText("Paid out to causes")).toBeTruthy();
  });
});

describe("ImpactSection — photo wall", () => {
  it("shows three different labelled illustrations when there are no photos yet — never an empty hole", () => {
    render(<ImpactSection impact={impact()} photos={[]} />);
    for (const label of ["Investment funds", "Asset funds", "Project funds"]) expect(screen.getByText(label)).toBeTruthy();
  });

  it("with a few photos, shows each once in a grid, labelled from the real event and linking to its vault", () => {
    render(<ImpactSection impact={impact()} photos={photos(3)} />);
    const img = screen.getByAltText("Delivered: Title 1 — Vault 1");
    expect(img.getAttribute("src")).toBe("http://x/p1.jpg");
    expect(img.closest("a")?.getAttribute("href")).toBe("/vaults/vault-1");
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.queryByText("Investment funds")).toBeNull(); // real photos replace the placeholders
  });

  it("includes the field team's caption in the description, and the right label per kind", () => {
    render(<ImpactSection impact={impact()} photos={[photo(2, { caption: "Handover to the committee" })]} />);
    expect(screen.getByAltText("Milestone reached: Title 2 — Vault 2. Handover to the committee")).toBeTruthy();
  });

  it("with many photos, becomes two scrolling rows; each row's loop copy is hidden from screen readers and the tab order", () => {
    const { container } = render(<ImpactSection impact={impact()} photos={photos(MARQUEE_MIN_PHOTOS + 4)} />);
    expect(container.querySelectorAll(".impact-marquee")).toHaveLength(2);
    expect(container.querySelectorAll('.impact-marquee-track[data-reverse="true"]')).toHaveLength(1);

    const duplicates = container.querySelectorAll('a[aria-hidden="true"]');
    const real = container.querySelectorAll(".impact-marquee a:not([aria-hidden])");
    expect(duplicates.length).toBe(real.length); // each row holds its photos exactly twice
    duplicates.forEach((a) => expect(a.getAttribute("tabindex")).toBe("-1"));
    // Every real photo is reachable by its real description; copies have none.
    expect(screen.getAllByAltText(/^Delivered: Title 1 — Vault 1$/).length).toBeGreaterThan(0);
    duplicates.forEach((a) => expect(a.querySelector("img")?.getAttribute("alt")).toBe(""));
  });

  it("repeats a short row enough times that the loop can't show a gap on a wide screen", () => {
    const { container } = render(<ImpactSection impact={impact()} photos={photos(MARQUEE_MIN_PHOTOS)} />);
    const row = container.querySelector(".impact-marquee-track")!;
    const real = row.querySelectorAll("a:not([aria-hidden])");
    expect(real.length).toBeGreaterThanOrEqual(10); // 4 photos per row, repeated up to at least 10 tiles per half
  });

  it("drops a photo that fails to load instead of showing a broken-image icon with its alt text", () => {
    render(<ImpactSection impact={impact()} photos={photos(3)} />);
    fireEvent.error(screen.getByAltText("Delivered: Title 1 — Vault 1"));
    expect(screen.queryByAltText("Delivered: Title 1 — Vault 1")).toBeNull();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
});

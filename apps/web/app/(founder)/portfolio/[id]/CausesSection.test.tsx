import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CausesSection } from "./CausesSection";
import type { CauseAllocationSummary, CauseCategory, WaqfCause } from "../../../../lib/types";

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

import { apiFetchJson } from "../../../../lib/api";

const mockedFetch = vi.mocked(apiFetchJson);

const categories: CauseCategory[] = [
  { id: "cat-poverty", name: "Poverty Relief", description: null, typicalWaqfTypes: ["asset"], parentId: null } as unknown as CauseCategory,
  { id: "cat-education", name: "Education", description: null, typicalWaqfTypes: ["asset"], parentId: null } as unknown as CauseCategory,
];

function cause(id: string, categoryId: string, name: string, allocatedAmount: string | null, committedAmount = "0"): WaqfCause {
  return {
    id, waqfId: "w1", causeCategoryId: categoryId, name, description: null, projectPlan: null, allocatedAmount, proceedsAllocatedAmount: null,
    createdAt: "2026-11-01T00:00:00.000Z", committedAmount, _count: { beneficiaries: 0, distributions: 0, pendingNominations: 0 },
  };
}

// The fund from the screenshot: ₦625,000 raised, ₦375,000 allocated.
const causes = [cause("c-poverty", "cat-poverty", "Poverty Relief", "200000", "80000"), cause("c-education", "cat-education", "Education", "175000")];
const summary: CauseAllocationSummary = {
  currency: "NGN", raised: "625000", allocated: "375000", heldByRemovedCauses: "0", available: "250000", appliesFloor: true,
};

function setup(list: WaqfCause[] = causes) {
  mockedFetch.mockImplementation(async (path: string) => {
    if (path === "/waqf-causes?waqfId=w1") return list;
    if (path === "/cause-categories") return categories;
    if (path === "/waqf-causes/allocation-summary?waqfId=w1") return summary;
    if (path.startsWith("/waqf-causes/")) return {};
    throw new Error(`Unhandled path in test: ${path}`);
  });
  render(<CausesSection waqfId="w1" waqfType="asset" amountRaised="625000" corpusCurrency="NGN" />);
  return userEvent.setup();
}

const card = async (name: string) => (await screen.findByText(name, { selector: "p" })).closest("div.rounded-md") as HTMLElement;
const sent = (path: string) => mockedFetch.mock.calls.find(([p, init]) => p === path && init?.method === "POST")?.[1];

describe("CausesSection — guided allocation changes", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  test("shows what's committed to a cause, and lowering it goes through a review that asks why", async () => {
    const user = setup();
    const poverty = await card("Poverty Relief");
    expect(within(poverty).getByText(/NGN 80,000.00 already committed/)).toBeInTheDocument();

    await user.click(within(poverty).getByRole("button", { name: "Change" }));
    const amount = within(poverty).getByLabelText(/Amount/);
    await user.clear(amount);
    await user.type(amount, "70000");
    // Below what's committed: refused before it's even reviewed.
    expect(within(poverty).getByText(/Can't go below NGN 80,000.00/)).toBeInTheDocument();
    expect(within(poverty).getByRole("button", { name: "Review" })).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, "150000");
    await user.click(within(poverty).getByRole("button", { name: "Review" }));
    const review = within(poverty).getByRole("region", { name: "Review the change" });
    expect(within(review).getByText(/NGN 250,000.00 → NGN 300,000.00/)).toBeInTheDocument();
    const confirm = within(review).getByRole("button", { name: "Confirm change" });
    expect(confirm).toBeDisabled();
    await user.type(within(review).getByLabelText("Why are you lowering it?"), "Moving part to school fees.");
    await user.click(confirm);

    await waitFor(() => expect(sent("/waqf-causes/c-poverty/allocate")).toBeDefined());
    expect(JSON.parse(sent("/waqf-causes/c-poverty/allocate")!.body as string)).toEqual({ amount: "150000", reason: "Moving part to school fees." });
  });

  test("a first allocation saves straight away, with no review", async () => {
    const user = setup([cause("c-poverty", "cat-poverty", "Poverty Relief", null), causes[1]]);
    const poverty = await card("Poverty Relief");
    await user.click(within(poverty).getByRole("button", { name: "Allocate" }));
    await user.type(within(poverty).getByLabelText(/Amount/), "100000");
    await user.click(within(poverty).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent("/waqf-causes/c-poverty/allocate")).toBeDefined());
    expect(JSON.parse(sent("/waqf-causes/c-poverty/allocate")!.body as string)).toEqual({ amount: "100000" });
  });

  test("moving takes only what isn't committed, shows both causes before and after, and sends the reason", async () => {
    const user = setup();
    const poverty = await card("Poverty Relief");
    await user.click(within(poverty).getByRole("button", { name: "Move" }));
    expect(within(poverty).getByText(/NGN 120,000.00 can move from Poverty Relief/)).toBeInTheDocument();
    await user.click(within(poverty).getByRole("button", { name: "Move all NGN 120,000.00" }));
    await user.click(within(poverty).getByRole("button", { name: "Review" }));

    const review = within(poverty).getByRole("region", { name: "Review the move" });
    expect(within(review).getByText("NGN 200,000.00 → NGN 80,000.00")).toBeInTheDocument();
    expect(within(review).getByText("NGN 175,000.00 → NGN 295,000.00")).toBeInTheDocument();
    await user.type(within(review).getByLabelText("Why are you moving it?"), "The school term starts sooner.");
    await user.click(within(review).getByRole("button", { name: "Confirm move" }));

    await waitFor(() => expect(sent("/waqf-causes/c-poverty/move")).toBeDefined());
    expect(JSON.parse(sent("/waqf-causes/c-poverty/move")!.body as string)).toEqual({
      toCauseId: "c-education", amount: "120000", reason: "The school term starts sooner.",
    });
  });

  test("removing a cause with an allocation says what stays committed and asks why", async () => {
    const user = setup();
    await screen.findByText("Poverty Relief", { selector: "p" });
    await user.click(screen.getByRole("checkbox", { name: /Poverty Relief/ }));
    expect(await screen.findByText(/NGN 80,000.00 has already been committed to its beneficiaries and stays counted/)).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Remove it anyway" });
    expect(remove).toBeDisabled();
    await user.type(screen.getByLabelText("Why are you removing it?"), "Folded into Education.");
    await user.click(remove);
    await waitFor(() => expect(sent("/waqf-causes/c-poverty/unselect")).toBeDefined());
    expect(JSON.parse(sent("/waqf-causes/c-poverty/unselect")!.body as string)).toEqual({ reason: "Folded into Education." });
  });
});

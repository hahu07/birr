import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignFoundationDeedForm } from "./SignFoundationDeedForm";
import type { Foundation } from "../../lib/types";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});
vi.mock("../../lib/founder-session", () => ({ useFounderSession: () => ({ user: { fullName: "Amina Bello" } }) }));

import { ApiError, apiFetchJson } from "../../lib/api";

const mockedApiFetchJson = vi.mocked(apiFetchJson);

const foundation = { id: "fdn-1", name: "Bello Family Foundation" } as Foundation;

function mockApi(preview: { joint: boolean; coFounders: string[]; awaitingConsent?: string[] }) {
  mockedApiFetchJson.mockImplementation(async (path: string) => {
    if (path === "/waqfs") return [{ id: "w1", name: "Scholarship Waqf", type: "investment", jurisdiction: "NG", foundationId: "fdn-1", status: "active" }];
    if (path === "/foundation-deeds/fdn-1/preview") {
      return { deedText: "DEED OF WAQF (ISLAMIC ENDOWMENT)\nThe full legal text.", textHash: "hash-1", awaitingConsent: [], ...preview };
    }
    if (path === "/foundation-deeds") return { id: "deed-1" };
    throw new Error(`Unexpected request: ${path}`);
  });
}

describe("SignFoundationDeedForm", { timeout: 15_000 }, () => {
  // A block body: a function returned from beforeEach runs as its teardown.
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
  });

  test("shows the full deed text that will be stored, not only a summary", async () => {
    mockApi({ joint: false, coFounders: [] });
    render(<SignFoundationDeedForm foundation={foundation} onSigned={vi.fn()} />);
    expect(await screen.findByLabelText("Full text of the Deed of Waqf")).toHaveTextContent("The full legal text.");
    expect(screen.queryByText(/A joint deed/)).not.toBeInTheDocument();
  });

  test("the exact stored text is one click away from the formatted deed", async () => {
    mockApi({ joint: false, coFounders: [] });
    render(<SignFoundationDeedForm foundation={foundation} onSigned={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("tab", { name: "Exact text" }));
    // Line breaks and all: the characters that are stored and hashed.
    const exact = screen.getByLabelText("Full text of the Deed of Waqf").querySelector("pre");
    expect(exact?.textContent).toBe("DEED OF WAQF (ISLAMIC ENDOWMENT)\nThe full legal text.");
  });

  test("a joint deed says who the signer signs for", async () => {
    mockApi({ joint: true, coFounders: ["Yusuf Bello"] });
    render(<SignFoundationDeedForm foundation={foundation} onSigned={vi.fn()} />);
    expect(await screen.findByText(/A joint deed\./)).toBeInTheDocument();
    expect(screen.getByText(/today, Yusuf Bello/)).toBeInTheDocument();
  });

  test("signing sends the hash of the deed that was shown", async () => {
    mockApi({ joint: false, coFounders: [] });
    const onSigned = vi.fn();
    render(<SignFoundationDeedForm foundation={foundation} onSigned={onSigned} />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Type your full legal name to sign"), "Amina Bello");
    const sign = screen.getByRole("button", { name: "Sign deed" });
    expect(sign).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(sign);

    await waitFor(() => expect(onSigned).toHaveBeenCalled());
    const [, init] = mockedApiFetchJson.mock.calls.find(([path]) => path === "/foundation-deeds")!;
    expect(JSON.parse(init!.body as string)).toEqual({
      foundationId: "fdn-1",
      typedLegalName: "Amina Bello",
      affirmed: true,
      textHash: "hash-1",
    });
  });

  async function fillAndSign() {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Type your full legal name to sign"), "Amina Bello");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign deed" }));
  }

  test("can't sign until every co-founder has agreed, and says who it's waiting for", async () => {
    mockApi({ joint: true, coFounders: ["Yusuf Bello", "Hauwa Bello"], awaitingConsent: ["Hauwa Bello"] });
    render(<SignFoundationDeedForm foundation={foundation} onSigned={vi.fn()} />);
    expect(await screen.findByText("Waiting for Hauwa Bello to agree")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Type your full legal name to sign"), "Amina Bello");
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Sign deed" })).toBeDisabled();
  });

  test("if someone else signed first, it shows the signed deed rather than asking to review again", async () => {
    mockApi({ joint: false, coFounders: [] });
    const base = mockedApiFetchJson.getMockImplementation()!;
    mockedApiFetchJson.mockImplementation(async (path, init) => {
      if (path === "/foundation-deeds") throw new ApiError("This foundation's deed has already been signed.", 409, "deed_already_signed");
      return base(path, init);
    });
    const onSigned = vi.fn();
    render(<SignFoundationDeedForm foundation={foundation} onSigned={onSigned} />);
    await fillAndSign();
    await waitFor(() => expect(onSigned).toHaveBeenCalled());
    expect(screen.queryByText(/review it again/)).not.toBeInTheDocument();
  });

  test("if the deed changed, the new text and the funds it covers are shown together", async () => {
    let activated = false;
    mockedApiFetchJson.mockImplementation(async (path: string) => {
      if (path === "/waqfs") {
        const funds = [{ id: "w1", name: "Scholarship Waqf", type: "investment", jurisdiction: "NG", foundationId: "fdn-1", status: "active" }];
        if (activated) funds.push({ id: "w2", name: "Water Waqf", type: "project", jurisdiction: "NG", foundationId: "fdn-1", status: "active" });
        return funds;
      }
      if (path === "/foundation-deeds/fdn-1/preview") {
        return { deedText: activated ? "DEED\nNow with Water Waqf." : "DEED\nThe full legal text.", textHash: activated ? "hash-2" : "hash-1", joint: false, coFounders: [], awaitingConsent: [] };
      }
      if (path === "/foundation-deeds") {
        activated = true;
        throw new ApiError("The deed changed since you opened it — review it again before signing.", 409, "deed_changed");
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<SignFoundationDeedForm foundation={foundation} onSigned={vi.fn()} />);
    await fillAndSign();
    expect(await screen.findByText("Water Waqf")).toBeInTheDocument();
    expect(screen.getByLabelText("Full text of the Deed of Waqf")).toHaveTextContent("Now with Water Waqf.");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});

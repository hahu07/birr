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

import { apiFetchJson } from "../../lib/api";

const mockedApiFetchJson = vi.mocked(apiFetchJson);

const foundation = { id: "fdn-1", name: "Bello Family Foundation" } as Foundation;

function mockApi(preview: { joint: boolean; coFounders: string[] }) {
  mockedApiFetchJson.mockImplementation(async (path: string) => {
    if (path === "/waqfs") return [{ id: "w1", name: "Scholarship Waqf", type: "investment", jurisdiction: "NG", foundationId: "fdn-1", status: "active" }];
    if (path === "/foundation-deeds/fdn-1/preview") {
      return { deedText: "DEED OF WAQF (ISLAMIC ENDOWMENT)\nThe full legal text.", textHash: "hash-1", ...preview };
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
});

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AcceptInvitationPage from "./page";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("token=tok-1&kind=co_founder") }));
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

import { ApiError, apiFetchJson } from "../../../lib/api";

const mockedApiFetchJson = vi.mocked(apiFetchJson);

const STATEMENT = "I join Bello Family Foundation as a co-founder. I authorize the founder who signs its Deed of Waqf to sign it for me.";

describe("Accept a co-founder invitation", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
    // The page navigates on success; jsdom can't, so give it somewhere to write.
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  });

  test("shows the Foundation and the exact deed statement, and can't join until it's accepted", async () => {
    mockedApiFetchJson.mockImplementation(async (path: string) => {
      if (path === "/invitations/preview?token=tok-1") {
        return {
          email: "yusuf@example.com",
          foundationName: "Bello Family Foundation",
          establishedJointly: true,
          invitedByName: "Amina Bello",
          deed: null,
          statement: { kind: "authorize_signer", text: STATEMENT, version: "2026-11-14-v1" },
        };
      }
      if (path === "/invitations/accept") return { invitation: { inviteeKind: "co_founder" } };
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<AcceptInvitationPage />);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Join Bello Family Foundation as a co-founder" })).toBeInTheDocument();
    expect(screen.getByText(/Amina Bello invited yusuf@example.com/)).toBeInTheDocument();
    expect(screen.getByText(STATEMENT)).toBeInTheDocument();

    // A joint Foundation's co-founders join as individuals: no institution option.
    expect(screen.getByText(/so you join it as an/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Institution/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Your full name"), "Yusuf Bello");
    await user.type(screen.getByLabelText("Full name"), "Yusuf Bello");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.type(screen.getByLabelText("Confirm password"), "correct-horse-battery");

    const join = screen.getByRole("button", { name: "Accept and join as co-founder" });
    expect(join).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I accept this statement/ }));
    await user.click(join);

    await waitFor(() => expect(window.location.href).toBe("/"));
    const [, init] = mockedApiFetchJson.mock.calls.find(([path]) => path === "/invitations/accept")!;
    expect(JSON.parse(init!.body as string)).toMatchObject({
      token: "tok-1",
      founderName: "Yusuf Bello",
      kind: "individual",
      deedConsentVersion: "2026-11-14-v1",
    });
  });

  test("says so when the invitation is no longer valid", async () => {
    mockedApiFetchJson.mockRejectedValue(new ApiError("Invitation not found.", 404));
    render(<AcceptInvitationPage />);
    expect(await screen.findByText("This invitation isn't valid anymore")).toBeInTheDocument();
  });
});

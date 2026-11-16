import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoFounderConsentPanel } from "./CoFounderConsentPanel";

vi.mock("../../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

import { ApiError, apiFetchJson } from "../../../../../lib/api";

const mocked = vi.mocked(apiFetchJson);
const AUTHORIZE = { kind: "authorize_signer", text: "I join Bello Family Waqf as a co-founder. I authorize the founder who signs…", version: "v1", hash: "h-1" };

describe("CoFounderConsentPanel", { timeout: 15_000 }, () => {
  beforeEach(() => mocked.mockReset());

  test("shows nothing when no agreement is needed", async () => {
    mocked.mockResolvedValue(null);
    const { container } = render(<CoFounderConsentPanel foundationId="f1" isPrimaryContact onAgreed={vi.fn()} />);
    await waitFor(() => expect(mocked).toHaveBeenCalledWith("/foundation-deeds/f1/consent"));
    expect(container).toBeEmptyDOMElement();
  });

  test("the primary contact agrees to the statement shown, by its hash", async () => {
    mocked.mockImplementation(async (path, init) => (init?.method === "POST" ? { id: "c1" } : AUTHORIZE));
    const onAgreed = vi.fn();
    render(<CoFounderConsentPanel foundationId="f1" isPrimaryContact onAgreed={onAgreed} />);
    const user = userEvent.setup();
    expect(await screen.findByText(AUTHORIZE.text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agree" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(onAgreed).toHaveBeenCalled());
    expect(mocked).toHaveBeenCalledWith("/foundation-deeds/f1/consent", { method: "POST", body: JSON.stringify({ statementHash: "h-1" }) });
  });

  test("other members see the statement but can't agree for the founder", async () => {
    mocked.mockResolvedValue(AUTHORIZE);
    render(<CoFounderConsentPanel foundationId="f1" isPrimaryContact={false} onAgreed={vi.fn()} />);
    expect(await screen.findByText(/Only your account's primary contact can agree/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agree" })).toBeNull();
  });

  test("if the deed was signed meanwhile, shows the new statement to agree to instead", async () => {
    const ADOPT = { kind: "adopt_signed_deed", text: "I adopt its Deed of Waqf, signed by Amina Bello…", version: "v1", hash: "h-2" };
    let signed = false;
    mocked.mockImplementation(async (path, init) => {
      if (init?.method === "POST") {
        signed = true;
        throw new ApiError("The deed changed while you were reading.", 409, "statement_changed");
      }
      return signed ? ADOPT : AUTHORIZE;
    });
    render(<CoFounderConsentPanel foundationId="f1" isPrimaryContact onAgreed={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Agree" }));
    expect(await screen.findByText(ADOPT.text)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Adopt this Foundation's deed" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RequestManageLinksPage from "./page";

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

import { apiFetchJson } from "../../../../lib/api";

const mocked = vi.mocked(apiFetchJson);

describe("Ask for monthly-gift links again", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mocked.mockReset();
    mocked.mockImplementation(async (path: string) => {
      if (path === "/giving/whatsapp/code") return { sent: true, number: "+2348031234567" };
      if (path === "/giving/whatsapp/confirm") return { whatsapp: "+2348031234567", proof: "proof-1" };
      return { sent: true };
    });
  });

  test("by email, as before", async () => {
    const user = userEvent.setup();
    render(<RequestManageLinksPage />);
    await user.type(screen.getByRole("textbox", { name: "Email" }), "amina@example.com");
    await user.click(screen.getByRole("button", { name: "Email me my links" }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith("/giving/manage-links", { method: "POST", body: JSON.stringify({ email: "amina@example.com" }) }));
    expect(screen.getByText(/we've emailed a private link/)).toBeInTheDocument();
  });

  test("by WhatsApp, only once the number is confirmed", async () => {
    const user = userEvent.setup();
    render(<RequestManageLinksPage />);
    await user.click(screen.getByRole("radio", { name: "WhatsApp" }));
    const send = screen.getByRole("button", { name: "Send my links by WhatsApp" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("WhatsApp number"), "08031234567");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.click(await screen.findByLabelText("Digit 1"));
    await user.paste("654321");
    await screen.findByText(/confirmed/);
    await user.click(send);
    await waitFor(() =>
      expect(mocked).toHaveBeenCalledWith("/giving/manage-links", { method: "POST", body: JSON.stringify({ whatsapp: "+2348031234567", whatsappProof: "proof-1" }) }),
    );
    expect(screen.getByText(/sent a private link for each gift by WhatsApp/)).toBeInTheDocument();
  });
});

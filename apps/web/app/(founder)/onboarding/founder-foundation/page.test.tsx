import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OnboardingFounderFoundationPage from "./page";

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

import { apiFetchJson } from "../../../../lib/api";

const mockedApiFetchJson = vi.mocked(apiFetchJson);

function establishBody(): FormData {
  const [, init] = mockedApiFetchJson.mock.calls.find(([path]) => path === "/founders/establish")!;
  return init!.body as FormData;
}

describe("Onboarding step 2 — establishing jointly", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
    mockedApiFetchJson.mockImplementation(async (path: string) => {
      if (path === "/founders/me") return { founder: null };
      if (path === "/founders/establish") return { founder: { id: "fd-1" }, foundation: { id: "fdn-1" } };
      throw new Error(`Unexpected request: ${path}`);
    });
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  });

  test("Jointly establishes as an individual on a Foundation marked joint, with the co-founder invites open", async () => {
    render(<OnboardingFounderFoundationPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: /Jointly/ }));
    // No institution fields, and the invites show without the extra tick.
    expect(screen.queryByLabelText("Institution type")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Co-founder 1 email")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Your full name"), "Amina Bello");
    await user.type(screen.getByLabelText("Name"), "Bello Family Foundation");
    await user.type(screen.getByLabelText("Purpose"), "Educating orphans in Kano.");
    await user.click(screen.getByRole("button", { name: "Establish Foundation" }));

    await waitFor(() => expect(window.location.href).toBe("/onboarding/waqf-fund"));
    const body = establishBody();
    expect(body.get("kind")).toBe("individual");
    expect(body.get("establishedJointly")).toBe("true");
    expect(body.get("institutionType")).toBeNull();
  });

  test("an institution is never marked joint", async () => {
    render(<OnboardingFounderFoundationPage />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Institution name"), "Kano Islamic Relief Initiative");
    await user.type(screen.getByLabelText("Name"), "Kano Relief Foundation");
    await user.type(screen.getByLabelText("Purpose"), "Relief across Kano.");
    await user.click(screen.getByRole("button", { name: "Establish Foundation" }));

    await waitFor(() => expect(window.location.href).toBe("/onboarding/waqf-fund"));
    expect(establishBody().get("kind")).toBe("institution");
    expect(establishBody().get("establishedJointly")).toBeNull();
  });
});

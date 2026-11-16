import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CountrySelect } from "./CountrySelect";

describe("CountrySelect", () => {
  test("finds a country by name or code and gives back its two-letter code", async () => {
    const onChange = vi.fn();
    render(<CountrySelect id="j" value="" onChange={onChange} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "nigeria");
    await user.click(screen.getByRole("option", { name: "Nigeria (NG)" }));
    expect(onChange).toHaveBeenCalledWith("NG");

    await user.clear(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "(AE)");
    expect(screen.getByRole("option", { name: "United Arab Emirates (AE)" })).toBeInTheDocument();
  });
});

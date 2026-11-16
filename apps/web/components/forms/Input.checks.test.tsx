import { describe, test, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@birr/ui";
import type { ComponentProps } from "react";

type InputProps = ComponentProps<typeof Input>;

// The shared Input checks fields as they're typed (2026-11-16), with the
// same rules the API applies, after the owner found the counterparty form
// took a 24-digit phone, a licence number of "adewale" and an authority of
// "345666".
function Field(props: InputProps) {
  const [value, setValue] = useState("");
  return (
    <form>
      <Input aria-label="field" value={value} onChange={(e) => setValue(e.target.value)} {...props} />
      <button type="submit">Save</button>
    </form>
  );
}

describe("Input checks", () => {
  test("a phone box takes only phone characters, stops at a phone's length, and says when it isn't one", async () => {
    render(<Field type="tel" />);
    const user = userEvent.setup();
    const box = screen.getByLabelText("field") as HTMLInputElement;
    await user.type(box, "0705abc-7878");
    expect(box.value).toBe("0705-7878");
    await user.clear(box);
    // Browsers stop typing at maxlength; user-event doesn't for type="tel",
    // so the 24 digits go in here and the check below catches them.
    expect(box.maxLength).toBe(20);
    await user.type(box, "070578781111111111111111");
    expect(screen.queryByRole("alert")).toBeNull(); // not while typing
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a phone number");
    expect(box.validity.valid).toBe(false); // the form won't submit

    await user.clear(box);
    await user.type(box, "0803 123 4567");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(box.validity.valid).toBe(true);
    expect(box).toHaveFocus(); // the message going didn't remount the box
  });

  test("a name needs letters, a reference number needs digits", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Field check="name" />);
    await user.type(screen.getByLabelText("field"), "345666");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("letters");
    unmount();

    render(<Field check="reference" />);
    await user.type(screen.getByLabelText("field"), "adewale");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("digits");
  });

  test("an email or web address is checked; blank is left to required", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Field type="email" />);
    const box = screen.getByLabelText("field") as HTMLInputElement;
    await user.click(box);
    await user.tab();
    expect(screen.queryByRole("alert")).toBeNull();
    await user.type(box, "bob@");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("valid email address");
    unmount();

    render(<Field type="url" />);
    await user.type(screen.getByLabelText("field"), "example.ng");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("https://");
  });
});

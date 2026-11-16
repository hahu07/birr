import { describe, test, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpInput } from "./OtpInput";

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <OtpInput value={value} onChange={setValue} disabled={false} invalid={false} />
      <output data-testid="code">{value}</output>
    </>
  );
}

const code = () => screen.getByTestId("code").textContent;

describe("OtpInput", () => {
  test("correcting one digit keeps the ones after it", async () => {
    render(<Harness initial="123456" />);
    await userEvent.click(screen.getByLabelText("Digit 3"));
    await userEvent.keyboard("9");
    expect(code()).toBe("129456");
  });

  test("a digit typed past the end goes in the next empty box", async () => {
    render(<Harness initial="1" />);
    await userEvent.click(screen.getByLabelText("Digit 5"));
    await userEvent.keyboard("7");
    expect(code()).toBe("17");
  });

  test("Backspace removes one digit and keeps the rest", async () => {
    render(<Harness initial="123456" />);
    await userEvent.click(screen.getByLabelText("Digit 2"));
    await userEvent.keyboard("{Backspace}");
    expect(code()).toBe("13456");
  });

  test("pasting a whole code fills every box", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText("Digit 1"));
    await userEvent.paste("654321");
    expect(code()).toBe("654321");
  });
});

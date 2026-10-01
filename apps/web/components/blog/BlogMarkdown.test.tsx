import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BlogMarkdown } from "./BlogMarkdown";

describe("BlogMarkdown", () => {
  it("renders an example container with its title and nested markdown", () => {
    render(<BlogMarkdown source={":::example A family in Kano\nThey set aside **₦50,000,000**.\n\n- one\n- two\n:::\n\nAfter."} />);
    expect(screen.getByText("A family in Kano")).toBeTruthy();
    expect(screen.getByText("₦50,000,000").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("After.")).toBeTruthy();
  });

  it("renders a table with a header row", () => {
    render(<BlogMarkdown source={"| | Zakat | Waqf |\n|---|---|---|\n| Kept? | No | Yes |"} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getByText("Yes").tagName).toBe("TD");
  });

  it("drops links with an unsafe scheme", () => {
    render(<BlogMarkdown source="[click](javascript:alert(1)) and [ok](/blog)" />);
    expect(screen.queryByRole("link", { name: "click" })).toBeNull();
    expect(screen.getByRole("link", { name: "ok" })).toBeTruthy();
  });

  it("still parses a table and a heading that sit next to an example box", () => {
    const src = "Intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n:::example Case\nText.\n:::\n\n## After heading\n\nEnd.";
    render(<BlogMarkdown source={src} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "After heading" })).toBeTruthy();
  });

  it("renders an image on its own line with its description as the caption", () => {
    render(<BlogMarkdown source={"Before.\n\n![Children at the borehole](https://cdn.example.org/a.jpg)\n\nAfter."} />);
    const img = screen.getByAltText("Children at the borehole");
    expect(img.getAttribute("src")).toBe("https://cdn.example.org/a.jpg");
    expect(img.closest("figure")?.textContent).toContain("Children at the borehole");
    expect(screen.getByText("Before.")).toBeTruthy();
    expect(screen.getByText("After.")).toBeTruthy();
  });

  it("refuses an image whose link isn't http(s) — it falls through as plain text, never an <img>", () => {
    const { container } = render(<BlogMarkdown source={"![x](javascript:alert(1))\n\n![y](data:text/html;base64,AAAA)"} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});

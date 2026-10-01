import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ArticleSummary } from "../../lib/blog-meta";
import { ArticleCard } from "./ArticleCard";

const article = (over: Partial<ArticleSummary> = {}): ArticleSummary => ({
  slug: "what-is-a-waqf",
  title: "What is a waqf?",
  description: "A short guide to waqf.",
  category: "founder-education",
  illustration: "endowment",
  coverImageUrl: null,
  authorName: "Birr Editorial",
  reviewedByName: "A. Reviewer",
  publishedAt: "2026-10-01T00:00:00.000Z",
  readMinutes: 3,
  ...over,
});

describe("ArticleCard", () => {
  it("shows the built-in illustration when there's no cover photo", () => {
    const { container } = render(<ArticleCard article={article()} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the uploaded cover photo instead of the illustration when one is set", () => {
    const { container } = render(<ArticleCard article={article({ coverImageUrl: "http://x/cover.jpg" })} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("http://x/cover.jpg");
    expect(container.querySelector("svg[role='img']")).toBeNull();
    expect(screen.getByText("What is a waqf?")).toBeTruthy();
  });
});

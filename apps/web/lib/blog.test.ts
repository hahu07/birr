import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listArticles, parseArticle } from "./blog";

const base = (extra = "") => `---
title: Hello
description: A test article
date: 2026-10-15
author: Birr Editorial
category: trust
${extra}---
Body text.`;

describe("parseArticle", () => {
  it("parses a reviewed, published article", () => {
    const a = parseArticle("hello", base("reviewedBy: A. Reviewer\n"));
    expect(a.title).toBe("Hello");
    expect(a.reviewedBy).toBe("A. Reviewer");
    expect(a.draft).toBe(false);
    expect(a.body).toBe("Body text.");
  });

  it("refuses to publish an article with no reviewer", () => {
    expect(() => parseArticle("hello", base())).toThrow(/reviewedBy/);
  });

  it("allows a draft without a reviewer", () => {
    expect(parseArticle("hello", base("draft: true\n")).draft).toBe(true);
  });

  it("rejects a missing field, bad date, unknown category and bad slug", () => {
    expect(() => parseArticle("hello", base("reviewedBy: X\n").replace("title: Hello\n", ""))).toThrow(/title/);
    expect(() => parseArticle("hello", base("reviewedBy: X\n").replace("2026-10-15", "15/10/2026"))).toThrow(/date/);
    expect(() => parseArticle("hello", base("reviewedBy: X\n").replace("trust", "gossip"))).toThrow(/category/);
    expect(() => parseArticle("Bad Slug", base("reviewedBy: X\n"))).toThrow(/slug/);
  });
});

describe("listArticles", () => {
  it("hides drafts and sorts newest first", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-"));
    fs.writeFileSync(path.join(dir, "old.md"), base("reviewedBy: X\n"));
    fs.writeFileSync(path.join(dir, "new.md"), base("reviewedBy: X\n").replace("2026-10-15", "2026-11-01"));
    fs.writeFileSync(path.join(dir, "wip.md"), base("draft: true\n"));
    expect(listArticles(dir).map((a) => a.slug)).toEqual(["new", "old"]);
  });
});

// Blog content loader. Articles are plain Markdown files in
// apps/web/content/blog/<slug>.md with a small frontmatter block, read at
// build time — no database, no CMS, no backend. That's deliberate: every
// article reaches production through a reviewed PR, so git history is the
// audit trail of what was published and when.
//
// Sign-off is enforced here, structurally, not by convention. Marketing
// about a fiduciary service is itself regulated (see CLAUDE.md's Bashir
// row: draft -> human review -> publish, always, and claims about
// licensing/returns/compliance need Legal/Compliance specifically). A
// published article (draft is not "true") MUST name a `reviewedBy`, or
// parseArticle throws and `next build` fails — an AI-drafted piece can't
// slip out with nobody's name on the approval.
import fs from "node:fs";
import path from "node:path";

export const BLOG_CATEGORIES = {
  "founder-education": "For Founders",
  vaults: "Vaults & giving",
  trust: "Trust & transparency",
  seasonal: "Seasonal",
} as const;
export type BlogCategory = keyof typeof BLOG_CATEGORIES;

export interface Article {
  slug: string;
  title: string;
  description: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  author: string;
  /** Who signed this off — required unless the article is still a draft. */
  reviewedBy: string | null;
  category: BlogCategory;
  draft: boolean;
  body: string;
}

const DEFAULT_BLOG_DIR = path.join(process.cwd(), "content", "blog");
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseArticle(slug: string, raw: string): Article {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Blog slug "${slug}" must be lowercase letters, digits and hyphens.`);
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`Blog article "${slug}" is missing its frontmatter block.`);

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) throw new Error(`Blog article "${slug}": bad frontmatter line "${line}".`);
    fields[line.slice(0, idx).trim()] = line
      .slice(idx + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }

  const need = (key: string): string => {
    if (!fields[key]) throw new Error(`Blog article "${slug}" is missing required frontmatter "${key}".`);
    return fields[key];
  };

  const date = need("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error(`Blog article "${slug}": date must be a real YYYY-MM-DD date, got "${date}".`);
  }
  const category = need("category");
  if (!(category in BLOG_CATEGORIES)) {
    throw new Error(`Blog article "${slug}": unknown category "${category}".`);
  }
  const draft = fields.draft === "true";
  const reviewedBy = fields.reviewedBy || null;
  if (!draft && !reviewedBy) {
    throw new Error(
      `Blog article "${slug}" is published but has no "reviewedBy" — a named human reviewer is required before anything goes out. Set "draft: true" until it has one.`,
    );
  }

  return {
    slug,
    title: need("title"),
    description: need("description"),
    date,
    author: need("author"),
    reviewedBy,
    category: category as BlogCategory,
    draft,
    body: match[2].trim(),
  };
}

/** Published articles only, newest first. Drafts are never built or listed. */
export function listArticles(dir: string = DEFAULT_BLOG_DIR): Article[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseArticle(f.slice(0, -3), fs.readFileSync(path.join(dir, f), "utf8")))
    .filter((a) => !a.draft)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getArticle(slug: string, dir?: string): Article | undefined {
  return listArticles(dir).find((a) => a.slug === slug);
}

export function formatArticleDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Public blog index — static, built from content/blog at build time (see
// lib/blog.ts). Public regardless of founder session; see app-shell.tsx's
// PUBLIC_ROUTES.
import type { Metadata } from "next";
import Link from "next/link";
import { featuredArticles } from "../../../lib/blog";
import { SiteFooter, SiteHeader } from "../SiteChrome";
import { ArticleCard } from "./ArticleCard";

export const metadata: Metadata = {
  title: "Learn — Birr",
  description: "Plain-English guides to waqf, trusteeship and giving through Birr.",
  alternates: { types: { "application/rss+xml": "/blog/feed.xml" } },
};

export default function BlogIndexPage() {
  const articles = featuredArticles(Infinity);
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <div className="mx-auto max-w-5xl px-6 py-16 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">Learn</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Understanding waqf, in plain English
        </h1>
        <p className="mt-3 text-lg text-slate-600">
          Guides for founders and givers — what a waqf is, how trusteeship works, and what happens to money given
          through Birr.
        </p>

        {articles.length === 0 ? (
          <p className="mt-12 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            Our first guides are on the way. In the meantime, see{" "}
            <Link href="/#waqf-types" className="font-medium text-primary-700 hover:text-primary-800">
              the Waqf Fund types Birr manages
            </Link>
            .
          </p>
        ) : (
          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {articles.map((a) => (
              <ArticleCard key={a.slug} article={a} />
            ))}
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}

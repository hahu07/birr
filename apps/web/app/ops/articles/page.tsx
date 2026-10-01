"use client";

// Public blog articles. Anyone in an authoring role can draft and edit;
// taking one live is a governed blog.publish action — proposed by a
// Mutawalli Officer, approved by Legal or Compliance on the Approvals
// page (see BlogController / seed-data.ts). Why it's gated at all:
// marketing about a fiduciary service is regulated.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import { BLOG_CATEGORIES } from "../../../lib/blog-meta";
import type { BlogArticle } from "../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, IconFileText, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton } from "../_components/SectionChrome";
import { ARTICLE_STATUS_TONE } from "./status";

export default function ArticlesPage() {
  const [articles, setArticles] = useState<BlogArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetchJson<BlogArticle[]>("/blog-articles")
      .then(setArticles)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
            <IconFileText className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Articles</h1>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
              Educational articles for the public blog. Drafts are private; publishing needs a second person —
              Legal or Compliance — to approve it on the Approvals page.
            </p>
          </div>
        </div>
        <Link href="/ops/articles/new">
          <Button>New article</Button>
        </Link>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load articles" className="mb-4">
          {error}
        </Alert>
      )}
      {!error && articles === null && <RowsSkeleton columns={5} />}
      {!error && articles !== null && articles.length === 0 && (
        <EmptyState title="No articles yet" description="Write the first one — it starts as a private draft." />
      )}

      {!error && articles !== null && articles.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Category</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Reviewed by</TableHeaderCell>
              <TableHeaderCell>Updated</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {articles.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium text-slate-900">
                  <Link href={`/ops/articles/${a.id}`} className="hover:text-primary-700">
                    {a.title}
                  </Link>
                  <span className="block text-xs font-normal text-slate-400">/blog/{a.slug}</span>
                </TableCell>
                <TableCell className="text-slate-500">
                  {BLOG_CATEGORIES[a.category as keyof typeof BLOG_CATEGORIES] ?? humanize(a.category)}
                </TableCell>
                <TableCell>
                  <Badge tone={ARTICLE_STATUS_TONE[a.status]}>{humanize(a.status)}</Badge>
                </TableCell>
                <TableCell className="text-slate-500">{a.reviewedByName ?? "—"}</TableCell>
                <TableCell className="text-slate-500">{new Date(a.updatedAt).toLocaleDateString("en-GB")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

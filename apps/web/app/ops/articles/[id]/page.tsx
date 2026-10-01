"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import { BLOG_CATEGORIES } from "../../../../lib/blog-meta";
import type { BlogArticle } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Skeleton } from "@birr/ui";
import { BlogMarkdown } from "../../../../components/blog/BlogMarkdown";
import { ILLUSTRATIONS } from "../../../../components/blog/illustrations";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";
import { ArticleForm, type ArticleFormValues } from "../ArticleForm";
import { ARTICLE_STATUS_TONE } from "../status";

export default function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { staff } = useStaffSession();
  const [article, setArticle] = useState<BlogArticle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"unpublish" | "archive" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<BlogArticle>(`/blog-articles/${id}`)
      .then(setArticle)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(values: ArticleFormValues) {
    const updated = await apiFetchJson<BlogArticle>(`/blog-articles/${id}`, { method: "PATCH", body: JSON.stringify(values) });
    setArticle(updated);
  }

  async function run(action: "unpublish" | "archive") {
    setBusy(true);
    setActionError(null);
    try {
      await apiFetchJson(`/blog-articles/${id}/${action}`, { method: "POST" });
      setConfirming(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Alert tone="danger" title="Couldn't load this article">
        {error}
      </Alert>
    );
  }
  if (!article) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-96" />
      </div>
    );
  }

  const canPropose = staff?.staffRole === "mutawalli_officer";
  const Illustration = ILLUSTRATIONS[article.illustration as keyof typeof ILLUSTRATIONS];

  return (
    <div>
      <header className="mb-8">
        <Link href="/ops/articles" className="text-sm text-slate-500 hover:text-primary-700">
          ← Articles
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{article.title}</h1>
              <Badge tone={ARTICLE_STATUS_TONE[article.status]}>{humanize(article.status)}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {BLOG_CATEGORIES[article.category as keyof typeof BLOG_CATEGORIES] ?? article.category} · /blog/{article.slug}
              {article.reviewedByName && ` · Reviewed by ${article.reviewedByName}`}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {article.status === "draft" && canPropose && (
                <ProposeGovernedActionButton
                  permissionKey="blog.publish"
                  payload={{ articleId: article.id }}
                  label="Propose publish"
                  onProposed={load}
                />
              )}
              {article.status === "published" && (
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setConfirming("unpublish")}>
                  Unpublish
                </Button>
              )}
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setConfirming("archive")}>
                Archive
              </Button>
            </div>
            {article.status === "draft" && !canPropose && (
              <p className="max-w-xs text-right text-xs text-slate-500">
                Only a Mutawalli Officer proposes publication; Legal or Compliance then approves it.
              </p>
            )}
          </div>
        </div>
      </header>

      {actionError && (
        <Alert tone="danger" title="That didn't work" className="mb-4">
          {actionError}
        </Alert>
      )}

      {confirming && (
        <Alert tone="warning" title={confirming === "unpublish" ? "Take this article off the public site?" : "Archive this article?"} className="mb-6">
          <p className="mb-3">
            {confirming === "unpublish"
              ? "It goes back to draft and disappears from the blog. Publishing it again will need a fresh review."
              : "It's removed from this list and the public site. Archived articles are kept for the audit trail, not deleted."}
          </p>
          <div className="flex gap-2">
            <Button className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => run(confirming)}>
              {busy ? "…" : confirming === "unpublish" ? "Yes, unpublish" : "Yes, archive"}
            </Button>
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </Alert>
      )}

      {article.status === "draft" ? (
        <ArticleForm article={article} onSubmit={save} submitLabel="Save draft" />
      ) : (
        <div className="max-w-2xl">
          <Alert tone="info" title="Read-only" className="mb-6">
            Approved text is frozen. To change it, unpublish the article first so the edit goes back through review.
          </Alert>
          {Illustration && (
            <div className="mb-6 rounded-2xl bg-gradient-to-br from-primary-50 to-accent-50 px-6 py-6">
              <Illustration className="mx-auto h-44 w-auto" />
            </div>
          )}
          <BlogMarkdown source={article.body} />
        </div>
      )}
    </div>
  );
}

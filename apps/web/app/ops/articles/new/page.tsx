"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import type { BlogArticle } from "../../../../lib/ops-types";
import { ArticleForm, type ArticleFormValues } from "../ArticleForm";

export default function NewArticlePage() {
  const router = useRouter();

  async function create(values: ArticleFormValues) {
    const article = await apiFetchJson<BlogArticle>("/blog-articles", { method: "POST", body: JSON.stringify(values) });
    router.push(`/ops/articles/${article.id}`);
  }

  return (
    <div>
      <header className="mb-8">
        <Link href="/ops/articles" className="text-sm text-slate-500 hover:text-primary-700">
          ← Articles
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">New article</h1>
        <p className="mt-0.5 text-sm text-slate-500">Saved as a private draft. Nothing is public until it's approved.</p>
      </header>
      <ArticleForm onSubmit={create} submitLabel="Save draft" />
    </div>
  );
}

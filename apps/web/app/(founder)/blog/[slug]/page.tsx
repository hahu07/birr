// One article, fetched from the backend's public endpoint — which only
// ever returns published articles, so an unpublished draft 404s here
// exactly like a slug that doesn't exist. Rendered on demand and
// revalidated every few minutes (a newly approved article needs no
// redeploy). Server Component: it can't import from "@birr/ui" (that barrel pulls in
// client-only components), so the CTAs below are plain styled links.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedArticle } from "../../../../lib/blog-api";
import { BLOG_CATEGORIES, formatArticleDate } from "../../../../lib/blog-meta";
import { SITE_URL } from "../../../../lib/site";
import { SiteFooter, SiteHeader } from "../../SiteChrome";
import { BlogMarkdown } from "../../../../components/blog/BlogMarkdown";
import { ILLUSTRATIONS } from "../../../../components/blog/illustrations";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);
  if (!article) return {};
  return {
    title: `${article.title} — Birr`,
    description: article.description,
    alternates: { canonical: `${SITE_URL}/blog/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.description,
      type: "article",
      publishedTime: article.publishedAt,
      ...(article.coverImageUrl ? { images: [article.coverImageUrl] } : {}),
    },
  };
}

export default async function BlogArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);
  if (!article) notFound();
  const Illustration = ILLUSTRATIONS[article.illustration];

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <article className="mx-auto max-w-2xl px-6 py-16 sm:px-8">
        <Link href="/blog" className="text-sm font-medium text-primary-700 hover:text-primary-800">
          ← All guides
        </Link>
        <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {BLOG_CATEGORIES[article.category]}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{article.title}</h1>
        <p className="mt-3 text-sm text-slate-500">
          By {article.authorName} · {formatArticleDate(article.publishedAt)} · Reviewed by {article.reviewedByName}
        </p>
        {article.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={article.coverImageUrl} alt="" className="mt-8 h-64 w-full rounded-2xl object-cover sm:h-80" />
        ) : (
          <div className="mt-8 rounded-2xl bg-gradient-to-br from-primary-50 to-accent-50 px-6 py-8">
            <Illustration className="mx-auto h-56 w-auto sm:h-64" />
          </div>
        )}
        <div className="mt-10">
          <BlogMarkdown source={article.body} />
        </div>

        <div className="mt-16 rounded-2xl border border-primary-100 bg-primary-50 px-6 py-8">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Ready to start?</h2>
          <p className="mt-2 text-sm text-slate-600">
            Establish your own Waqf Fund in minutes, or give to one of Birr's open Vaults.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700"
            >
              Establish a Waqf Fund
            </Link>
            <Link
              href="/vaults"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Support a cause
            </Link>
          </div>
        </div>
      </article>
      <SiteFooter />
    </div>
  );
}

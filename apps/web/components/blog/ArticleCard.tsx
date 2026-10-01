// Article card shared by the homepage's "Featured articles" section and
// the /blog index. Each article names its own illustration (see
// illustrations.tsx) so a card says what it's about at a glance. The whole
// card is one Link (same reasoning as VaultCard in SiteChrome.tsx).
import Link from "next/link";
import { BLOG_CATEGORIES, type ArticleSummary } from "../../lib/blog-meta";
import { ILLUSTRATIONS } from "./illustrations";

export function ArticleCard({ article }: { article: ArticleSummary }) {
  const Illustration = ILLUSTRATIONS[article.illustration];
  return (
    <Link
      href={`/blog/${article.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative bg-gradient-to-br from-primary-50 to-accent-50 px-6 pt-4">
        <Illustration className="mx-auto h-44 w-auto transition group-hover:scale-[1.03]" />
        <div className="absolute left-4 top-4 flex gap-2">
          <span className="rounded-md bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-sm">
            {BLOG_CATEGORIES[article.category]}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs text-slate-500">{article.readMinutes} min read</p>
        <h3 className="mt-2 text-lg font-semibold leading-snug tracking-tight text-slate-900 group-hover:text-primary-700">
          {article.title}
        </h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{article.description}</p>
        <span className="mt-4 text-sm font-semibold text-primary-700">
          Read article <span aria-hidden="true">→</span>
        </span>
      </div>
    </Link>
  );
}

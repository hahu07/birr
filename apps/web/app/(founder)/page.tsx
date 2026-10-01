// "/" — see HomeEntry.tsx for the signed-out/signed-in branch. This stays a
// Server Component only so the marketing page can fetch published
// articles (lib/blog-api.ts) and the live impact figures
// (lib/impact-api.ts) from the backend — a Client Component can't do that
// at request/revalidate time without a loading flash on a page that's
// meant to be the first thing a visitor sees.
import { listPublishedArticles } from "../../lib/blog-api";
import { getImpactSummary, visibleImpact } from "../../lib/impact-api";
import HomeEntry from "./HomeEntry";

export const revalidate = 300;

export default async function HomePage() {
  const [articles, impact] = await Promise.all([listPublishedArticles(3), getImpactSummary()]);
  return <HomeEntry articles={articles} impact={visibleImpact(impact)} />;
}

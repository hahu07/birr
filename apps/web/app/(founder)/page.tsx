// "/" — see HomeEntry.tsx for the signed-out/signed-in branch. This stays a
// Server Component only so the marketing page's "Featured articles"
// section can fetch published articles from the backend (lib/blog-api.ts)
// — a Client Component can't do that at request/revalidate time without a
// loading flash on a page that's meant to be the first thing a visitor sees.
import { listPublishedArticles } from "../../lib/blog-api";
import HomeEntry from "./HomeEntry";

export const revalidate = 300;

export default async function HomePage() {
  return <HomeEntry articles={await listPublishedArticles(3)} />;
}

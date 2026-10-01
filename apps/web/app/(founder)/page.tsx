// "/" — see HomeEntry.tsx for the signed-out/signed-in branch. This stays a
// Server Component only so the marketing page's "Featured articles"
// section can read content/blog at build time (lib/blog.ts) — client
// components can't touch the filesystem.
import { featuredArticles } from "../../lib/blog";
import HomeEntry from "./HomeEntry";

export default function HomePage() {
  return <HomeEntry articles={featuredArticles(3)} />;
}

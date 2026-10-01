import { listArticles } from "../../../../lib/blog";
import { SITE_URL } from "../../../../lib/site";

export const dynamic = "force-static";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function GET() {
  const items = listArticles()
    .map(
      (a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${SITE_URL}/blog/${a.slug}</link>
      <guid>${SITE_URL}/blog/${a.slug}</guid>
      <pubDate>${new Date(`${a.date}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${esc(a.description)}</description>
    </item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Birr — Learn</title>
    <link>${SITE_URL}/blog</link>
    <description>Plain-English guides to waqf, trusteeship and giving through Birr.</description>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}

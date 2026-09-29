import type { Metadata } from "next";
import { apiFetchJson } from "../../../../lib/api";
import { humanize } from "../../../../lib/format";
import type { Vault } from "../../../../lib/types";

// Per-vault Open Graph/Twitter Card metadata — see the parent
// vaults/layout.tsx's own comment for why this needs to be a sibling
// file to page.tsx (a Client Component) rather than added there
// directly, and for the "no link preview" finding this closes. A
// Server Component; generateMetadata runs server-side regardless of the
// page's own client/server nature or the (also-client) FounderLayout it
// renders under.
//
// Reuses the exact GET /vaults/by-slug/:slug route the client page
// itself calls — a second request (Next.js doesn't share fetch results
// between a layout's generateMetadata and a client page's own
// useEffect), but this route is @Public()/cheap, and the alternative
// (lifting all of that page's client-side state into a server fetch
// passed down as props) was a much larger, riskier rewrite of a
// 450-line file for a metadata-only fix.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const vault = await apiFetchJson<Vault | null>(`/vaults/by-slug/${slug}`).catch(() => null);

  if (!vault) {
    return { title: "Vault not found — Birr" };
  }

  const title = `${vault.name} — Birr`;
  const description = vault.description?.trim() || `Support this ${humanize(vault.type)} vault through Birr.`;
  const images = vault.coverImageUrl ? [{ url: vault.coverImageUrl }] : undefined;

  return {
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Birr", images },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images: images?.map((i) => i.url) },
  };
}

export default function VaultDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}

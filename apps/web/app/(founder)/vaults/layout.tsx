import type { Metadata } from "next";

// Static defaults for the public "browse all open vaults" index
// (/vaults) — and the fallback social-preview fields for any child route
// (e.g. /vaults/:slug) that doesn't override them. A Server Component,
// deliberately separate from this segment's own page.tsx (a Client
// Component — see that file's own comment): generateMetadata/metadata
// must be exported from a server module, but that's independent of
// whether the page itself is a client component, so this file needs no
// changes to that one.
//
// 2026-09-29 codebase walkthrough finding: neither this page nor
// /vaults/:slug had any Open Graph/Twitter Card metadata at all, so a
// link shared to WhatsApp/Twitter/Facebook/Slack rendered as bare text —
// no title, no image, nothing that makes a stranger want to click a
// charity donation link. No metadataBase is set here since every image
// URL involved (Vault.coverImageUrl) is already an absolute URL — see
// VaultCoverStorageService.saveCover.
export const metadata: Metadata = {
  title: "Open Vaults — Birr",
  description: "Public giving campaigns you can support directly, with no account needed.",
  openGraph: {
    title: "Open Vaults — Birr",
    description: "Public giving campaigns you can support directly, with no account needed.",
    type: "website",
    siteName: "Birr",
  },
  twitter: {
    card: "summary_large_image",
    title: "Open Vaults — Birr",
    description: "Public giving campaigns you can support directly, with no account needed.",
  },
};

export default function VaultsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

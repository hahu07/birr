import type { Metadata } from "next";

// Static defaults for Kifayah's public pages, the same pattern as /clinics'
// layout.
const description = "Birr's graduation programme: helping poor households reach sufficiency, by their own means, with Birr as trustee.";

export const metadata: Metadata = {
  title: "Kifayah — Birr",
  description,
  openGraph: { title: "Kifayah — Birr", description, type: "website", siteName: "Birr" },
  twitter: { card: "summary", title: "Kifayah — Birr", description },
};

export default function KifayahLayout({ children }: { children: React.ReactNode }) {
  return children;
}

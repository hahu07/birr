import type { Metadata } from "next";

// Share-preview metadata for the public zakah calculator — a server
// module, separate from the client page, same reason as /vaults's own
// layout.tsx. This link is what gets passed around on WhatsApp in
// Ramadan, so it needs a real title and description, not bare text.
const title = "Zakah Calculator — Birr";
const description = "Work out your zakah in Naira against today's nisab. Your figures stay on your device.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", siteName: "Birr" },
  twitter: { card: "summary", title, description },
};

export default function ZakahLayout({ children }: { children: React.ReactNode }) {
  return children;
}

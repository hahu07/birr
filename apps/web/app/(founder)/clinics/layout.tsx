import type { Metadata } from "next";

// Static defaults for the public clinics list (/clinics) and the fallback
// social-preview fields for each clinic's own page (/clinics/:slug), the
// same pattern as /vaults' layout.
export const metadata: Metadata = {
  title: "Clinics — Birr",
  description: "Laboratories and clinics for women and young children, each held in a waqf with Birr as trustee.",
  openGraph: {
    title: "Clinics — Birr",
    description: "Laboratories and clinics for women and young children, each held in a waqf with Birr as trustee.",
    type: "website",
    siteName: "Birr",
  },
  twitter: {
    card: "summary",
    title: "Clinics — Birr",
    description: "Laboratories and clinics for women and young children, each held in a waqf with Birr as trustee.",
  },
};

export default function ClinicsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

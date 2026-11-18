import type { Metadata } from "next";

// Static defaults for the public need-based waqf pages, the same pattern as
// /clinics' layout. "Need-based waqf" is a working name.
const description = "Waqfs that help poor households earn a living, or live with dignity, with Birr as trustee.";

export const metadata: Metadata = {
  title: "Need-based waqf — Birr",
  description,
  openGraph: { title: "Need-based waqf — Birr", description, type: "website", siteName: "Birr" },
  twitter: { card: "summary", title: "Need-based waqf — Birr", description },
};

export default function NeedBasedWaqfLayout({ children }: { children: React.ReactNode }) {
  return children;
}

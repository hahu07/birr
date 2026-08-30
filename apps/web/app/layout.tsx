import "./globals.css";

// Deliberately bare — no session provider lives at this level. Founder
// and Ops Console sessions are scoped to their own route groups
// (app/(founder)/layout.tsx, app/ops/layout.tsx) so a page in one never
// triggers a session fetch for the other, even though both now live in
// the same deployment. See CLAUDE.md's Tech Stack section and this
// merge's own plan notes for why that separation is still worth keeping
// at the code level.
export const metadata = {
  title: "Birr",
  description: "A digital trustee for Islamic waqf.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900">{children}</body>
    </html>
  );
}

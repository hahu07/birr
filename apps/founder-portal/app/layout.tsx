import "./globals.css";
import { FounderSessionProvider } from "../lib/founder-session";
import { AppShell } from "./app-shell";

export const metadata = {
  title: "Birr — Founder Portal",
  description: "View and manage the waqf you've established with Birr.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900">
        <FounderSessionProvider>
          <AppShell>{children}</AppShell>
        </FounderSessionProvider>
      </body>
    </html>
  );
}

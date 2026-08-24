import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { StaffSessionProvider } from "../lib/staff-session";
import { AppShell } from "./app-shell";

// Self-hosted by next/font (no runtime request to Google Fonts) — a
// confident, slightly warmer sans than the bare system-font stack, used
// only in this app (see the app-scoped override in globals.css).
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

export const metadata = {
  title: "Birr — Ops Console",
  description: "Internal governance console for Birr staff.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plexSans.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900">
        <StaffSessionProvider>
          <AppShell>{children}</AppShell>
        </StaffSessionProvider>
      </body>
    </html>
  );
}

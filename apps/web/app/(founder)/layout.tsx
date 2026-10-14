import { Fraunces, Inter } from "next/font/google";
import { FounderSessionProvider } from "../../lib/founder-session";
import { AppShell } from "./app-shell";

// Self-hosted by next/font (no runtime request to Google Fonts). Only the
// CSS variables are declared here — the signed-in Founder Portal opts in
// via `.founder-app` (see globals.css and app-shell.tsx), so the public
// marketing/giving pages in this same route group keep their current
// type until they're redesigned on purpose. Inter for the interface —
// chosen over Plus Jakarta Sans and Manrope after measuring: both render
// word spaces ~2px at 12px wherever text is pixel-snapped (common on
// Linux), which read as "BelloFamily"; Inter's stay 3-4px. Fraunces only for
// display headings and headline money figures — an endowment's "legacy"
// register, used sparingly.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });

export default function FounderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} ${fraunces.variable}`}>
      <FounderSessionProvider>
        <AppShell>{children}</AppShell>
      </FounderSessionProvider>
    </div>
  );
}

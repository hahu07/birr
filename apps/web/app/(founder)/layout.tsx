import { Fraunces, Inter } from "next/font/google";
import { FounderSessionProvider } from "../../lib/founder-session";
import { AppShell } from "./app-shell";

// Self-hosted by next/font (no runtime request to Google Fonts). Only the
// CSS variables are declared here — pages opt in via `.founder-app` (see
// globals.css and app-shell.tsx, which applies it to the signed-in portal
// and the public pages alike). Fraunces loads its true italic too: the
// homepage hero and the dashboard's impact quote set display italics, and
// a browser-faked slant on a serif reads as a mistake. Inter for the interface —
// chosen over Plus Jakarta Sans and Manrope after measuring: both render
// word spaces ~2px at 12px wherever text is pixel-snapped (common on
// Linux), which read as "BelloFamily"; Inter's stay 3-4px. Fraunces only for
// display headings and headline money figures — an endowment's "legacy"
// register, used sparingly.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-fraunces", display: "swap" });

export default function FounderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} ${fraunces.variable}`}>
      <FounderSessionProvider>
        <AppShell>{children}</AppShell>
      </FounderSessionProvider>
    </div>
  );
}

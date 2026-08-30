import { IBM_Plex_Sans } from "next/font/google";
import { StaffSessionProvider } from "../../lib/staff-session";
import { AppShell } from "./app-shell";

// Self-hosted by next/font (no runtime request to Google Fonts) — a
// confident, slightly warmer sans than the bare system-font stack for
// this dense admin surface. Scoped to /ops only via the `.ops-shell`
// class below (see globals.css) rather than `:root`, since a nested
// layout can't touch the root <html> element the way a standalone app's
// root layout could — and scoping it explicitly here is exactly the
// point: nothing under app/(founder) should pick this up.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`ops-shell ${plexSans.variable}`}>
      <StaffSessionProvider>
        <AppShell>{children}</AppShell>
      </StaffSessionProvider>
    </div>
  );
}

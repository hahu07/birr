import { FounderSessionProvider } from "../../lib/founder-session";
import { AppShell } from "./app-shell";

export default function FounderLayout({ children }: { children: React.ReactNode }) {
  return (
    <FounderSessionProvider>
      <AppShell>{children}</AppShell>
    </FounderSessionProvider>
  );
}

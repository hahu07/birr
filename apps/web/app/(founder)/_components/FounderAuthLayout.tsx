// The Founder side's split-screen auth layout (sign-in, sign-up, forgot/
// reset password) — same shape and props as @birr/ui's AuthSplitLayout,
// which stays as-is for /ops/sign-in and /ops/accept-invitation. This one
// carries the Founder Portal's 2026-10 look: deep emerald + gold instead
// of the teal→violet ramp, Fraunces display type, the geometric lattice,
// and a few plain statements of how Birr works. Those statements are
// product facts, not licensing/returns/regulatory claims (see CLAUDE.md's
// note on financial-promotion copy) — keep any future edits that way.
import { ReactNode } from "react";
import { IconCheckCircle, IconMark } from "@birr/ui";
import { GeometricPattern } from "./ui";

const POINTS = [
  "Establish a Foundation and Waqf Fund yourself — no approval gate.",
  "Every governance decision needs two different Birr officers.",
  "Every action is recorded in an immutable audit trail.",
];

export function FounderAuthLayout({
  children,
  eyebrow,
  headline,
  subcopy,
}: {
  children: ReactNode;
  eyebrow?: string;
  headline: string;
  subcopy?: string;
}) {
  return (
    <div className="founder-app flex min-h-screen bg-white">
      <div className="flex w-full flex-col justify-center px-6 py-10 sm:px-12 lg:w-1/2 lg:px-20">
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>

      <div className="relative hidden overflow-hidden bg-gradient-to-br from-primary-950 via-primary-900 to-primary-700 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-1/2">
        <GeometricPattern className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.05]" />
        <div className="pointer-events-none absolute -right-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-accent-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-primary-400/10 blur-3xl" />

        <div className="relative z-10 flex h-full w-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-2.5">
            <IconMark className="h-10 w-10" />
            <span className="text-lg font-semibold tracking-tight text-white">Birr</span>
          </div>
          <div className="max-w-md">
            {eyebrow && <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-accent-300">{eyebrow}</p>}
            <h2 className="font-display text-4xl font-medium leading-tight tracking-tight text-white">{headline}</h2>
            {subcopy && <p className="mt-4 text-sm leading-relaxed text-primary-100/80">{subcopy}</p>}
            <ul className="mt-8 space-y-3 border-t border-white/10 pt-8">
              {POINTS.map((p) => (
                <li key={p} className="flex items-start gap-3 text-sm text-primary-50/90">
                  <IconCheckCircle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent-300" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

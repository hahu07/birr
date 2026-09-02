import { ReactNode } from "react";
import { IconMark } from "./icons";

export interface AuthSplitLayoutProps {
  /** The actual form/card — rendered in the left column. */
  children: ReactNode;
  /** Small uppercase label above the headline, e.g. "OPS CONSOLE". */
  eyebrow?: string;
  headline: string;
  subcopy?: string;
  /**
   * Controls the decorative panel's gradient. "founder" (default) is the
   * public-facing teal→violet treatment; "ops" is a cooler, more
   * restrained slate→indigo treatment — a deliberate visual cue that
   * you're in a different, internal system, echoing the logical
   * separation between the two route groups that use this component.
   */
  tone?: "founder" | "ops";
}

// Four stops each, not a straight two-color interpolation: sRGB
// interpolation between primary and violet passes through a desaturated
// gray-navy dead zone across the middle third (measured live — this was
// the same "dead charcoal band" in both panels). Holding a saturated
// mid-ramp waypoint on each side of the transition keeps color present
// nearly edge to edge instead of fading to mud in the middle.
const GRADIENTS: Record<NonNullable<AuthSplitLayoutProps["tone"]>, string> = {
  founder:
    "linear-gradient(135deg in oklch, var(--color-primary-900) 0%, var(--color-primary-700) 40%, var(--color-violet-800) 75%, var(--color-violet-600) 100%)",
  // Cooler and more restrained than "founder" (the ops-vs-public visual
  // cue this component documents), but still a saturated navy-violet
  // waypoint rather than flat slate — the previous #0f172a stop was
  // where the dead band lived.
  ops: "linear-gradient(135deg in oklch, var(--color-primary-900) 0%, var(--color-primary-800) 35%, #1e2547 60%, var(--color-violet-800) 85%, var(--color-violet-600) 100%)",
};

/**
 * Split-screen auth/landing chrome shared by the public sign-in/sign-up
 * pages and /ops/sign-in: a plain white form column on the left, a
 * colorful gradient panel with a headline/subcopy slot on the right.
 * One place for this pattern instead of copy-pasting it across three
 * pages — see the founder-portal/ops-console merge plan this came from.
 */
export function AuthSplitLayout({ children, eyebrow, headline, subcopy, tone = "founder" }: AuthSplitLayoutProps) {
  return (
    <div className="flex h-screen bg-white">
      <div className="flex w-full flex-col justify-center overflow-y-auto px-6 py-8 sm:px-12 lg:w-1/2 lg:px-20">
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>

      <div
        className="relative hidden overflow-hidden lg:flex lg:w-1/2 lg:items-end"
        style={{ backgroundImage: GRADIENTS[tone] }}
      >
        {/* Decorative radial glow, top-right */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-[36rem] w-[36rem] rounded-full bg-white/10 blur-3xl" />
        {/* Decorative thin diagonal lines */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(115deg, transparent 0px, transparent 58px, rgba(255,255,255,0.6) 58px, rgba(255,255,255,0.6) 59px)",
          }}
        />

        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <IconMark className="h-10 w-10" />
          <div className="max-w-md">
            {eyebrow && (
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/70">{eyebrow}</p>
            )}
            <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">{headline}</h2>
            {subcopy && <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70">{subcopy}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

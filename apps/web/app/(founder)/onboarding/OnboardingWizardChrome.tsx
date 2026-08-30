"use client";

// Chrome for the 4-step onboarding wizard — deliberately no Sidebar/nav,
// since a founder has zero dashboard access until all 4 steps complete
// (see app-shell.tsx's third gate state, which renders this instead of
// the normal shell).
import { useRouter } from "next/navigation";
import { StepProgress, IconMark } from "@birr/ui";
import { ROUTE_FOR_STEP } from "../../../lib/onboarding";

const STEP_LABELS = ["Verify", "Founder & Foundation", "Waqf Fund", "Sign deed"];
const STEP_ROUTES = [ROUTE_FOR_STEP[1], ROUTE_FOR_STEP[2], ROUTE_FOR_STEP[3], ROUTE_FOR_STEP[4]];

// Same teal-to-violet ramp as AuthSplitLayout's "founder" tone (see that
// component's own comment on the oklch waypoints) — one consistent
// brand gradient across sign-in/sign-up and this wizard, not two
// different looks for what's really the same establishment journey.
const HEADER_GRADIENT =
  "linear-gradient(135deg in oklch, var(--color-primary-900) 0%, var(--color-primary-700) 40%, var(--color-violet-800) 75%, var(--color-violet-600) 100%)";

export function OnboardingWizardChrome({
  currentStep,
  children,
}: {
  currentStep: 1 | 2 | 3 | 4 | "done";
  children: React.ReactNode;
}) {
  const currentIndex = currentStep === "done" ? STEP_LABELS.length : currentStep - 1;
  const router = useRouter();
  // Steps 2 (Founder & Foundation) and 3 (Waqf Fund) each sit next to a
  // reference panel (FounderFoundationGuide / WaqfTypeGuide) explaining
  // their jargon-heavy fields — that needs real room beside the form,
  // not squeezed into the same 2xl column every other step uses.
  const contentMaxWidth = currentStep === 2 || currentStep === 3 ? "max-w-4xl" : "max-w-2xl";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="relative overflow-hidden" style={{ backgroundImage: HEADER_GRADIENT }}>
        {/* Decorative radial glow + diagonal lines, same treatment as
            AuthSplitLayout's gradient panel — kept behind everything
            (z-0) so the icon/title/step-progress stay crisp on top. */}
        <div className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-64 w-64 rounded-full bg-accent-400/10 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(115deg, transparent 0px, transparent 58px, rgba(255,255,255,0.6) 58px, rgba(255,255,255,0.6) 59px)",
          }}
        />

        <div className="relative px-6 py-6 sm:px-10">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
              <IconMark className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-accent-300">Waqf Trustee Platform</p>
              <p className="text-sm font-semibold tracking-tight text-white">Establishing your Founder account</p>
            </div>
          </div>
        </div>
      </header>

      {/* Step progress stays on a plain light bar, not the gradient —
          StepProgress is styled for a light background (slate/primary
          text tones) and is only ever used here, so this is simpler
          than teaching it a dark-background variant for one caller. */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 sm:px-10">
        <div className="mx-auto max-w-2xl">
          <StepProgress
            steps={STEP_LABELS}
            currentIndex={currentIndex}
            onStepClick={(index) => router.push(STEP_ROUTES[index])}
          />
        </div>
      </div>

      <main className="relative overflow-hidden px-6 py-12 sm:px-10 sm:py-16">
        {/* Soft, low-opacity color washes behind the form content —
            "robust" background without competing with the white Cards
            every step's form renders on top of it. */}
        <div className="pointer-events-none absolute -left-40 top-0 h-[28rem] w-[28rem] rounded-full bg-primary-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -right-32 top-1/3 h-96 w-96 rounded-full bg-violet-200/30 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-accent-200/30 blur-3xl" />

        <div className={`relative mx-auto ${contentMaxWidth}`}>{children}</div>
      </main>
    </div>
  );
}

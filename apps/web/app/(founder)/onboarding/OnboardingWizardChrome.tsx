"use client";

// Chrome for the 4-step onboarding wizard — deliberately no Sidebar/nav,
// since a founder has zero dashboard access until all 4 steps complete
// (see app-shell.tsx's third gate state, which renders this instead of
// the normal shell).
import { useRouter } from "next/navigation";
import { IconLogOut, IconMark, StepProgress } from "@birr/ui";
import { useFounderSession } from "../../../lib/founder-session";
import { GeometricPattern } from "../_components/ui";
import { ROUTE_FOR_STEP } from "../../../lib/onboarding";

const STEP_LABELS = ["Verify", "Founder & Foundation", "Waqf Fund", "Sign deed"];
const STEP_ROUTES = [ROUTE_FOR_STEP[1], ROUTE_FOR_STEP[2], ROUTE_FOR_STEP[3], ROUTE_FOR_STEP[4]];

export function OnboardingWizardChrome({
  currentStep,
  children,
}: {
  currentStep: 1 | 2 | 3 | 4 | "done";
  children: React.ReactNode;
}) {
  const currentIndex = currentStep === "done" ? STEP_LABELS.length : currentStep - 1;
  const router = useRouter();
  const { signOut } = useFounderSession();
  // Steps 2 (Founder & Foundation) and 3 (Waqf Fund) each sit next to a
  // reference panel (FounderFoundationGuide / WaqfTypeGuide) explaining
  // their jargon-heavy fields — that needs real room beside the form,
  // not squeezed into the same 2xl column every other step uses.
  const contentMaxWidth = currentStep === 2 || currentStep === 3 ? "max-w-5xl" : "max-w-2xl";

  async function handleSignOut() {
    await signOut();
    router.push("/sign-in");
  }

  return (
    // .founder-app: the Founder Portal's own type (see globals.css) —
    // this chrome is rendered by app-shell.tsx in place of the signed-in
    // shell, so it opts in itself.
    <div className="founder-app min-h-screen bg-slate-50">
      {/* Same deep emerald + gold as the signed-in shell and the Founder
          auth pages (2026-10 redesign; this used to be the teal→violet
          ramp shared with the older AuthSplitLayout). */}
      <header className="relative overflow-hidden bg-gradient-to-br from-primary-950 via-primary-900 to-primary-700">
        <GeometricPattern className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 text-white/[0.06] [mask-image:linear-gradient(to_left,black,transparent)]" />
        <div className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full bg-accent-400/15 blur-3xl" />

        <div className="relative px-6 py-5 sm:px-10">
          <div className={`mx-auto flex items-center gap-3 ${contentMaxWidth}`}>
            <IconMark className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-300">
                {currentStep === "done" ? "All set" : `Step ${currentStep} of ${STEP_LABELS.length} · ${STEP_LABELS[currentIndex]}`}
              </p>
              <p className="text-sm font-semibold tracking-tight text-white">Establishing your Founder account</p>
            </div>
            {/* The wizard replaces the whole signed-in shell (no sidebar
                until all four steps are done), so sign-out lives here —
                there was previously no way out of the wizard at all. */}
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-primary-100/80 ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/10 hover:text-white"
            >
              <IconLogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Step progress on a plain light bar, not the gradient —
          StepProgress is styled for a light background and is only ever
          used here. */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 sm:px-10">
        <div className="mx-auto max-w-2xl">
          <StepProgress
            steps={STEP_LABELS}
            currentIndex={currentIndex}
            onStepClick={(index) => router.push(STEP_ROUTES[index])}
          />
        </div>
      </div>

      <main className="px-4 py-10 sm:px-10 sm:py-14">
        <div className={`mx-auto ${contentMaxWidth}`}>{children}</div>
      </main>
    </div>
  );
}

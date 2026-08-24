"use client";

// Chrome for the 4-step onboarding wizard — deliberately no Sidebar/nav,
// since a founder has zero dashboard access until all 4 steps complete
// (see app-shell.tsx's third gate state, which renders this instead of
// the normal shell).
import { StepProgress, IconMark } from "@birr/ui";

const STEP_LABELS = ["Verify", "Founder & Foundation", "Waqf Fund", "Sign deed"];

export function OnboardingWizardChrome({
  currentStep,
  children,
}: {
  currentStep: 1 | 2 | 3 | 4 | "done";
  children: React.ReactNode;
}) {
  const currentIndex = currentStep === "done" ? STEP_LABELS.length : currentStep - 1;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-5 sm:px-10">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <IconMark className="h-8 w-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-tight text-slate-900">Establishing your Founder account</p>
          </div>
        </div>
        <div className="mx-auto mt-4 max-w-2xl">
          <StepProgress steps={STEP_LABELS} currentIndex={currentIndex} />
        </div>
      </header>
      <main className="px-6 py-12 sm:px-10 sm:py-16">
        <div className="mx-auto max-w-2xl">{children}</div>
      </main>
    </div>
  );
}

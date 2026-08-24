export interface StepProgressProps {
  steps: string[];
  currentIndex: number;
}

/** A simple 4-step horizontal indicator for the founder onboarding wizard. */
export function StepProgress({ steps, currentIndex }: StepProgressProps) {
  return (
    <ol className="flex items-center">
      {steps.map((label, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isComplete
                    ? "bg-primary-600 text-white"
                    : isCurrent
                      ? "bg-primary-50 text-primary-800 ring-2 ring-primary-600"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {isComplete ? "✓" : index + 1}
              </div>
              <span
                className={`whitespace-nowrap text-[11px] font-medium ${
                  isCurrent ? "text-primary-800" : isComplete ? "text-slate-600" : "text-slate-400"
                }`}
              >
                {label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className={`mx-3 h-px flex-1 ${isComplete ? "bg-primary-600" : "bg-slate-200"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

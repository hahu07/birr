export interface StepProgressProps {
  steps: string[];
  currentIndex: number;
  /**
   * Called with a step's index when its circle/label is clicked — fires
   * for any already-reached step (index <= currentIndex), which
   * includes the current step itself: if you've navigated back to
   * review an earlier one, the current step's own circle is how you get
   * back to where you actually were, not a dead end. Only future steps
   * (index > currentIndex) stay non-interactive — you can't skip ahead
   * of what's actually been completed. Left framework-agnostic on
   * purpose (no next/link — this package has zero Next.js dependency):
   * the caller decides how navigation actually happens (e.g. router.push
   * to that step's route).
   */
  onStepClick?: (index: number) => void;
}

/**
 * A simple 4-step horizontal indicator for the founder onboarding wizard.
 *
 * The connector lines are computed by explicit percentage math, not by
 * letting flexbox size them between sibling elements — an earlier
 * version tried that (a flex-1 divider between each circle+label
 * column) and it broke the moment labels had different lengths:
 * flex-col columns are sized by their widest content, and a long label
 * like "Founder & Foundation" is far wider than its own 28px circle, so
 * a line touching that column's edge lands well short of the circle
 * actually centered inside it. Every step column here has equal width
 * (100/steps.length%) regardless of label length, so a circle's center
 * is always at a fixed, predictable position — (index + 0.5) * columnWidth
 * — and the connector segments are positioned directly against that,
 * completely independent of how wide any label happens to render.
 */
export function StepProgress({ steps, currentIndex, onStepClick }: StepProgressProps) {
  const columnWidth = 100 / steps.length;

  return (
    <div className="relative">
      {/* mt-3.5 = half the circle's own height (h-7 = 28px) — lines up
          each segment with the circles' vertical center, which sit at
          the very top of the <ol> below. */}
      <div className="pointer-events-none absolute inset-x-0 top-3.5" aria-hidden="true">
        {steps.slice(0, -1).map((_, index) => {
          const isComplete = index < currentIndex;
          return (
            <div
              key={index}
              className={`absolute h-px ${isComplete ? "bg-primary-600" : "bg-slate-200"}`}
              style={{ left: `${(index + 0.5) * columnWidth}%`, width: `${columnWidth}%` }}
            />
          );
        })}
      </div>

      <ol className="relative flex">
        {steps.map((label, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isClickable = index <= currentIndex && Boolean(onStepClick);
          const circle = (
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                isComplete
                  ? "bg-primary-600 text-white"
                  : isCurrent
                    ? "bg-primary-50 text-primary-800 ring-2 ring-primary-600"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {isComplete ? "✓" : index + 1}
            </div>
          );
          const stepLabel = (
            <span
              className={`whitespace-nowrap text-[11px] font-medium ${
                isCurrent ? "text-primary-800" : isComplete ? "text-slate-600" : "text-slate-500"
              }`}
            >
              {label}
            </span>
          );
          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-1.5">
              {isClickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick!(index)}
                  className="flex flex-col items-center gap-1.5 rounded-md transition-opacity hover:opacity-70"
                  title={`Go to ${label}`}
                >
                  {circle}
                  {stepLabel}
                </button>
              ) : (
                <>
                  {circle}
                  {stepLabel}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

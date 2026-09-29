import { ComponentType } from "react";

export interface TabItem {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

export interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

/**
 * A plain underline tab bar — no headless-UI dependency, matching this
 * package's existing pattern of small, self-contained components. Scrolls
 * horizontally rather than wrapping on a narrow viewport, so a page with
 * several tabs doesn't jump in height between phone and desktop.
 *
 * Deliberately dumb: it only renders the bar and reports the clicked key
 * via onChange — the caller owns `active` state and whatever it decides
 * to do with it (e.g. lazy-mounting a tab's content only once it's first
 * been opened). See WaqfFundDetailPage's own comment for why that
 * decision belongs at the call site, not baked into this component.
 */
export function Tabs({ items, active, onChange, className = "" }: TabsProps) {
  return (
    <div role="tablist" className={`flex gap-1 overflow-x-auto border-b border-slate-200 ${className}`}>
      {items.map((item) => {
        const isActive = item.key === active;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.key)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

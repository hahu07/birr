import { IconProps } from "./types";

/**
 * Used for counts of actions proposed by AI agents (CLAUDE.md: agents may
 * only ever be a maker, never a checker — this mark labels the maker's
 * origin, it never appears near a decision control).
 */
export function IconSparkle({ className = "", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3.2l1.9 4.7 4.7 1.9-4.7 1.9-1.9 4.7-1.9-4.7-4.7-1.9 4.7-1.9L12 3.2Z" />
      <path d="M18.7 14.2l.95 2.15 2.15.95-2.15.95-.95 2.15-.95-2.15-2.15-.95 2.15-.95.95-2.15Z" />
    </svg>
  );
}

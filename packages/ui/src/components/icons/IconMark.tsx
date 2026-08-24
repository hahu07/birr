import { IconProps } from "./types";

/**
 * The Birr mark — a seal motif (endowment deeds are historically sealed
 * documents) rather than a bare letter in a box: a solid ring, a serif
 * "B" for warmth against the sans-serif UI type, and a small gold arc
 * standing in for the wax-seal ribbon. Used at small sizes (sidebar,
 * sign-in) so detail stays minimal on purpose.
 */
export function IconMark({ className = "", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label="Birr"
      {...props}
    >
      <circle cx="20" cy="20" r="19" className="fill-primary-700" />
      <path
        d="M20 2.6a17.4 17.4 0 0 1 12.3 5.1"
        className="stroke-accent-300"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      <text
        x="20"
        y="27.5"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="700"
        fontSize="19"
        className="fill-accent-300"
      >
        B
      </text>
    </svg>
  );
}

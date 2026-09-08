// Hand-authored SVG illustrations for the three Waqf Fund type detail
// pages — larger, more compositional cousins of the small line icons in
// @birr/ui's icons/ directory (same stroke language: 1.75 width, round
// caps/joins), not photography. There's no image asset pipeline in this
// app and no CDN this could load a stock photo from even if one were
// wanted — an SVG composition in the existing brand palette is both the
// achievable option and the one that actually looks like it belongs
// next to the rest of the product, not a bolted-on stock photo.
// Deliberately primary/accent only, no violet — see styles.css's
// documented hue rule (violet is reserved for the AI Agents surface).

export function InvestmentIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 240" className={className} role="img" aria-label="Ascending investment returns over a preserved corpus">
      <circle cx="160" cy="120" r="108" className="fill-primary-50" />
      <circle cx="230" cy="60" r="46" className="fill-accent-100" opacity="0.7" />

      {/* Baseline the bars sit on */}
      <line x1="60" y1="188" x2="266" y2="188" className="stroke-primary-200" strokeWidth="2" />

      {/* Ascending bars — the corpus at work, growing period over period */}
      <rect x="76" y="150" width="26" height="38" rx="4" className="fill-primary-200" />
      <rect x="118" y="128" width="26" height="60" rx="4" className="fill-primary-300" />
      <rect x="160" y="100" width="26" height="88" rx="4" className="fill-primary-500" />
      <rect x="202" y="70" width="26" height="118" rx="4" className="fill-primary-700" />

      {/* Smooth trend line arcing over the bars — the return, distinct
          from the bars (corpus) it's drawn above, never merged into them */}
      <path
        d="M70 172 C 110 150, 130 128, 172 96 S 232 56, 250 48"
        fill="none"
        className="stroke-accent-500"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="250" cy="48" r="6" className="fill-accent-500" />

      {/* Two small coin motifs — distributable income, drifting apart
          from the corpus bars rather than stacked on them */}
      <circle cx="92" cy="76" r="11" className="fill-accent-300" />
      <circle cx="92" cy="76" r="11" fill="none" className="stroke-accent-600" strokeWidth="1.5" />
      <circle cx="112" cy="58" r="7" className="fill-accent-200" />
      <circle cx="112" cy="58" r="7" fill="none" className="stroke-accent-500" strokeWidth="1.25" />
    </svg>
  );
}

export function AssetIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 240" className={className} role="img" aria-label="A physical asset held in trust">
      <circle cx="160" cy="120" r="108" className="fill-accent-50" />
      <circle cx="90" cy="70" r="40" className="fill-primary-100" opacity="0.7" />

      {/* Ground line + steps */}
      <line x1="56" y1="196" x2="264" y2="196" className="stroke-accent-300" strokeWidth="2" />
      <rect x="70" y="184" width="180" height="12" rx="2" className="fill-accent-200" />
      <rect x="82" y="172" width="156" height="12" rx="2" className="fill-accent-300" />

      {/* Pediment (triangular roof) */}
      <path d="M96 172 L160 118 L224 172 Z" className="fill-primary-600" />

      {/* Columns, evenly spaced beneath the pediment */}
      {[104, 132, 160, 188, 216].map((x) => (
        <rect key={x} x={x - 6} y="132" width="12" height="46" rx="2" className="fill-primary-500" />
      ))}
      <rect x="98" y="126" width="124" height="8" rx="2" className="fill-primary-700" />

      {/* A small seal/ribbon motif — "held in trust," echoing IconMark's
          own seal language rather than introducing an unrelated symbol */}
      <circle cx="238" cy="90" r="20" className="fill-accent-500" />
      <path d="M231 90 l5 5 10 -11" fill="none" className="stroke-white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProjectIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 240" className={className} role="img" aria-label="A defined initiative, several Founders standing behind it">
      <circle cx="160" cy="120" r="108" className="fill-primary-50" />
      <circle cx="220" cy="170" r="40" className="fill-accent-100" opacity="0.7" />

      {/* Connections drawn first so nodes sit cleanly on top */}
      <g className="stroke-primary-300" strokeWidth="2.5">
        <line x1="96" y1="86" x2="176" y2="120" />
        <line x1="96" y1="168" x2="176" y2="120" />
        <line x1="176" y1="120" x2="238" y2="76" />
        <line x1="176" y1="120" x2="238" y2="150" />
        <line x1="176" y1="120" x2="176" y2="176" />
      </g>

      {/* Four Founder nodes around the shared initiative */}
      <circle cx="96" cy="86" r="14" className="fill-primary-300" />
      <circle cx="96" cy="168" r="14" className="fill-primary-300" />
      <circle cx="238" cy="76" r="14" className="fill-primary-400" />
      <circle cx="238" cy="150" r="14" className="fill-primary-400" />

      {/* The initiative itself — larger, marked distinctly, everything
          else connects to it rather than to each other */}
      <circle cx="176" cy="120" r="24" className="fill-primary-700" />
      <path d="M176 108 v17 M176 133 h0.1" className="stroke-white" strokeWidth="3" strokeLinecap="round" />

      {/* A small milestone flag on the fifth node — a defined initiative
          has a stated purpose, not just funding flowing through it */}
      <circle cx="176" cy="176" r="12" className="fill-accent-400" />
      <path d="M176 168 v16 M176 169 l7 3 -7 3" fill="none" className="stroke-accent-800" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

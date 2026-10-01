// Hand-authored SVG illustrations for blog articles — same approach and
// palette as waqf-types/illustrations.tsx (brand primary/accent only, no
// violet, which is reserved for the AI surface; no image pipeline or CDN
// to load stock photography from). Each article names one by key in its
// frontmatter (`illustration: endowment`); the key is validated by
// lib/blog.ts, so a typo fails the build instead of rendering nothing.
// To add one: draw it here, add its key to ILLUSTRATION_KEYS in
// lib/blog-meta.ts, and register it in ILLUSTRATIONS below.
import type { ComponentType } from "react";
import type { IllustrationKey } from "../../lib/blog-meta";

type Props = { className?: string };

const heart = (x: number, y: number) =>
  `M${x} ${y + 14} C${x - 24} ${y - 4}, ${x - 14} ${y - 24}, ${x} ${y - 10} C${x + 14} ${y - 24}, ${x + 24} ${y - 4}, ${x} ${y + 14} Z`;

/** A tree rooted on a stack of coins: the asset stays, the benefit keeps growing. */
function Endowment({ className = "" }: Props) {
  return (
    <svg viewBox="0 0 320 240" className={className} role="img" aria-label="A tree growing from a stack of coins, dropping coins to the side">
      <circle cx="160" cy="120" r="108" className="fill-primary-50" />
      <circle cx="248" cy="58" r="40" className="fill-accent-100" opacity="0.8" />
      <line x1="54" y1="196" x2="266" y2="196" className="stroke-primary-200" strokeWidth="2" />

      {/* Coin stack — the preserved corpus */}
      <rect x="116" y="178" width="88" height="18" rx="9" className="fill-accent-500" />
      <rect x="122" y="162" width="76" height="18" rx="9" className="fill-accent-400" />
      <rect x="128" y="146" width="64" height="18" rx="9" className="fill-accent-300" />

      {/* Trunk + canopy */}
      <path d="M154 148 C 154 124, 156 112, 160 96 C 164 112, 166 124, 166 148 Z" className="fill-primary-800" />
      <circle cx="160" cy="76" r="34" className="fill-primary-600" />
      <circle cx="132" cy="94" r="24" className="fill-primary-500" />
      <circle cx="188" cy="94" r="24" className="fill-primary-500" />
      <circle cx="160" cy="58" r="20" className="fill-primary-400" />

      {/* Fruit that falls away from the tree — the income that actually gets spent */}
      <circle cx="226" cy="120" r="9" className="fill-accent-300" />
      <circle cx="226" cy="120" r="9" fill="none" className="stroke-accent-600" strokeWidth="1.5" />
      <circle cx="248" cy="152" r="9" className="fill-accent-300" />
      <circle cx="248" cy="152" r="9" fill="none" className="stroke-accent-600" strokeWidth="1.5" />
      <circle cx="238" cy="182" r="9" className="fill-accent-300" />
      <circle cx="238" cy="182" r="9" fill="none" className="stroke-accent-600" strokeWidth="1.5" />
      <path d="M200 84 C 220 90, 226 104, 226 108" fill="none" className="stroke-accent-500" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 6" />
    </svg>
  );
}

/** A shield with a check, held between two people: nothing moves on one person's say-so. */
function Trustee({ className = "" }: Props) {
  return (
    <svg viewBox="0 0 320 240" className={className} role="img" aria-label="Two people on either side of a shield with a check mark">
      <circle cx="160" cy="120" r="108" className="fill-accent-50" />
      <circle cx="82" cy="60" r="36" className="fill-primary-100" opacity="0.8" />

      {/* Two people — maker and checker, never the same one */}
      <circle cx="66" cy="112" r="16" className="fill-primary-300" />
      <path d="M38 176 C 38 146, 94 146, 94 176 Z" className="fill-primary-300" />
      <circle cx="254" cy="112" r="16" className="fill-accent-400" />
      <path d="M226 176 C 226 146, 282 146, 282 176 Z" className="fill-accent-400" />

      {/* Links from each person to the shield */}
      <path d="M96 140 L124 130" className="stroke-primary-400" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 7" />
      <path d="M224 140 L196 130" className="stroke-accent-500" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 7" />

      {/* Shield */}
      <path d="M160 52 L204 68 L204 122 C 204 154, 184 174, 160 186 C 136 174, 116 154, 116 122 L116 68 Z" className="fill-primary-600" />
      <path d="M160 64 L194 76 L194 122 C 194 148, 178 164, 160 174 Z" className="fill-primary-500" />
      <path d="M140 118 L156 134 L184 100" fill="none" stroke="white" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />

      {/* Ledger lines — the permanent record */}
      <rect x="112" y="200" width="96" height="6" rx="3" className="fill-primary-200" />
      <rect x="128" y="212" width="64" height="6" rx="3" className="fill-primary-100" />
    </svg>
  );
}

/** Three ways of giving: spend it (coin), share it (heart), keep it growing (sapling, tallest). */
function GivingTypes({ className = "" }: Props) {
  return (
    <svg viewBox="0 0 320 240" className={className} role="img" aria-label="Three columns: a coin, a heart, and a sapling on the tallest column">
      <circle cx="160" cy="120" r="108" className="fill-primary-50" />
      <circle cx="262" cy="52" r="34" className="fill-accent-100" opacity="0.8" />
      <line x1="46" y1="200" x2="274" y2="200" className="stroke-primary-200" strokeWidth="2" />

      {/* Zakat — shortest column, coin */}
      <rect x="56" y="150" width="62" height="50" rx="8" className="fill-primary-200" />
      <circle cx="87" cy="118" r="17" className="fill-accent-300" />
      <circle cx="87" cy="118" r="17" fill="none" className="stroke-accent-600" strokeWidth="2" />
      <path d="M81 118 L93 118 M87 111 L87 125" className="stroke-accent-700" strokeWidth="2.5" strokeLinecap="round" />

      {/* Sadaqah — middle column, heart */}
      <rect x="129" y="126" width="62" height="74" rx="8" className="fill-primary-300" />
      <path d={heart(160, 98)} className="fill-accent-400" />

      {/* Waqf — tallest column, sapling */}
      <rect x="202" y="96" width="62" height="104" rx="8" className="fill-primary-600" />
      <path d="M233 82 L233 62" className="stroke-primary-700" strokeWidth="4" strokeLinecap="round" />
      <path d="M233 70 C 214 70, 208 58, 210 48 C 224 48, 233 56, 233 70 Z" className="fill-primary-400" />
      <path d="M233 62 C 250 62, 256 50, 254 40 C 242 40, 233 48, 233 62 Z" className="fill-primary-500" />
      <rect x="214" y="122" width="38" height="6" rx="3" className="fill-primary-300" />
      <rect x="214" y="136" width="26" height="6" rx="3" className="fill-primary-400" />
    </svg>
  );
}

export const ILLUSTRATIONS: Record<IllustrationKey, ComponentType<Props>> = {
  endowment: Endowment,
  trustee: Trustee,
  "giving-types": GivingTypes,
};

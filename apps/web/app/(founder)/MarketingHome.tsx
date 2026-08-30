// Public landing page — the signed-out counterpart rendered at "/" by
// page.tsx (see app-shell.tsx's HOME_ROUTE handling: this is the one
// route that's public-or-private depending on session, not purely one
// or the other). No Founder Portal chrome — a first-time visitor hasn't
// signed up yet.
import Link from "next/link";
import { Button, Card, IconMark } from "@birr/ui";

// Four stops, not two-color interpolation across the full distance: a
// straight primary-900 → violet-700 sRGB ramp passes through a
// desaturated gray-navy dead zone in its middle third (measured live).
// Holding primary-700 as a mid-ramp waypoint keeps the teal saturated
// most of the way across before violet takes over near the edge, so the
// panel never dips into mud.
const GRADIENT =
  "linear-gradient(135deg in oklch, var(--color-primary-900) 0%, var(--color-primary-700) 40%, var(--color-violet-800) 75%, var(--color-violet-600) 100%)";

// A primary/accent pair, not a three-hue rainbow — violet is reserved
// exclusively for the AI Agents surface and agent-attribution elsewhere
// in the product (see styles.css's documented hue rationale); using it
// decoratively here, on the single most public page, would both break
// that contract and read as unrelated hues rather than a considered
// two-color brand pairing. Card 1 and 3 both carry primary (at two
// depths, via the icon chip) so the trio still reads as three distinct
// tiles, not two identical ones either side of a gold middle.
const FEATURES = [
  {
    title: "Self-service establishment",
    body: "Create your Foundation and Waqf Fund yourself — no Birr staff involvement, no approval gate.",
    icon: "◆",
    // Two explicit gradient depths for the two primary-tone cards, not a
    // CSS filter over one gradient — a filter darkens foreground and
    // background together in a way that isn't easily contrast-checkable;
    // an explicit deeper gradient is.
    iconClasses: "bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-primary-900/25",
    cardTone: "primary" as const,
  },
  {
    title: "Governed by design",
    body: "Ongoing asset, distribution, and investment decisions go through Birr's maker-checker governance.",
    icon: "◈",
    // Deep-on-gold, not white-on-gold: a from-accent-400 to-accent-600
    // gradient under white text measured below the 3:1 non-text-contrast
    // floor at its lighter stop. A lighter gold field with a near-black
    // glyph both clears AA with margin and reads as more premium.
    iconClasses: "bg-gradient-to-br from-accent-300 to-accent-500 text-accent-950 shadow-accent-900/20",
    cardTone: "accent" as const,
  },
  {
    title: "Full audit trail",
    body: "Every governed action is recorded — an immutable, append-only trail from establishment onward.",
    icon: "◇",
    iconClasses: "bg-gradient-to-br from-primary-700 to-primary-900 text-white shadow-primary-950/30",
    cardTone: "primary" as const,
  },
];

export default function MarketingHome() {
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-8">
        <div className="flex items-center gap-2.5">
          <IconMark className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">Birr</span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/sign-in" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Sign in
          </Link>
          <Link href="/sign-up">
            <Button variant="primary">Sign up</Button>
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden px-6 py-20 sm:px-8 sm:py-28" style={{ backgroundImage: GRADIENT }}>
        <div className="pointer-events-none absolute -right-32 -top-32 h-[36rem] w-[36rem] rounded-full bg-white/10 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(115deg, transparent 0px, transparent 58px, rgba(255,255,255,0.6) 58px, rgba(255,255,255,0.6) 59px)",
          }}
        />
        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/70">Waqf Trustee Platform</p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            A digital trustee for Islamic waqf.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/80">
            Establish your own Foundation and Waqf Fund, self-service — Birr becomes Mutawalli (trustee) over what
            you establish, as you agree, no approval gate.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/sign-up" className="w-full sm:w-auto">
              <Button variant="secondary" className="w-full">
                Sign up
              </Button>
            </Link>
            <Link href="/sign-in" className="text-sm font-medium text-white/80 hover:text-white">
              Already have an account? Sign in →
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-b from-primary-50/50 to-white px-6 py-16 sm:px-8">
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title} tone={feature.cardTone}>
              <span
                className={`mb-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg shadow-sm ${feature.iconClasses}`}
                aria-hidden="true"
              >
                {feature.icon}
              </span>
              <h3 className="text-sm font-semibold text-slate-900">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{feature.body}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

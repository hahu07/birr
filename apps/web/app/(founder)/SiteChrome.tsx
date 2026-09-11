"use client";

// Shared chrome for every public, signed-out-reachable page in this
// route group (the marketing home, /waqf-types/[type]) — one sticky
// header/footer and the scroll-reveal primitives, rather than each page
// re-implementing them slightly differently. Kept local to (founder)
// rather than promoted to @birr/ui: nothing outside this route group's
// public surface needs it.
import { ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, IconMark } from "@birr/ui";
import { WAQF_TYPE_CONTENT, WAQF_TYPE_SLUGS } from "./waqf-types/content";

// Four stops, not two-color interpolation across the full distance: a
// straight primary-900 → violet-700 sRGB ramp passes through a
// desaturated gray-navy dead zone in its middle third (measured live).
// Holding primary-700 as a mid-ramp waypoint keeps the teal saturated
// most of the way across before violet takes over near the edge, so the
// panel never dips into mud.
export const GRADIENT =
  "linear-gradient(135deg in oklch, var(--color-primary-900) 0%, var(--color-primary-700) 40%, var(--color-violet-800) 75%, var(--color-violet-600) 100%)";

// Reveals a section as it scrolls into view — a fade + slight rise,
// disabled outright under prefers-reduced-motion rather than merely
// shortened, since a user who's opted out shouldn't see any motion at
// all. IntersectionObserver rather than a scroll listener: no per-frame
// work, and it naturally handles elements already in view at mount.
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    );
    observer.observe(node);
    // Belt-and-braces: this is marketing content, not an app screen a
    // user already trusts is there — content must never stay invisible
    // because an observer callback got starved (a backgrounded tab, an
    // unusual embedding context, etc.). Whichever fires first wins; the
    // other is a no-op via the disconnect/clear below.
    const fallback = window.setTimeout(() => setInView(true), 1500);
    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return { ref, inView };
}

export function Reveal({ children, className = "", delayMs = 0 }: { children: ReactNode; className?: string; delayMs?: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none ${
        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      } ${className}`}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}

// Gains a border/shadow once the page scrolls past the hero, rather
// than sitting permanently elevated — an always-on shadow reads as
// "floating over nothing" while a colored panel is still visible
// directly beneath a plain white bar.
function useScrolled(thresholdPx = 8) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > thresholdPx);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [thresholdPx]);
  return scrolled;
}

// Section anchors live on "/" itself — "/#how-it-works" works whether
// the visitor is already on the home page (a same-page scroll) or on
// some other public page like /waqf-types/investment (a real
// navigation to "/" that then scrolls), so every page can share one
// nav without needing to know which page it's currently rendering.
const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/vaults", label: "Support a cause" },
  { href: "/#governance", label: "Governance" },
  { href: "/#ai", label: "AI" },
];

export function SiteHeader() {
  const scrolled = useScrolled();
  return (
    <header
      className={`sticky top-0 z-50 bg-white/95 backdrop-blur transition-shadow ${
        scrolled ? "shadow-sm border-b border-slate-200" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <IconMark className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">Birr</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Page sections">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm font-medium text-slate-600 hover:text-slate-900">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-5">
          <Link href="/sign-in" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Sign in
          </Link>
          <Link href="/sign-up">
            <Button variant="primary">Sign up</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

const FOOTER_PLATFORM_LINKS = [
  { href: "/#waqf-types", label: "What Birr manages" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/vaults", label: "Support a cause" },
  { href: "/#governance", label: "Governance" },
  { href: "/#ai", label: "AI" },
];

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <ul className="mt-4 space-y-2.5">{children}</ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-100 px-6 pb-10 pt-16 sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2 lg:col-span-2">
          <Link href="/" className="flex items-center gap-2.5">
            <IconMark className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-tight text-slate-900">Birr</span>
          </Link>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
            A digital trustee for Islamic waqf — establish your own Waqf Fund, or support one of Birr's own Vaults.
            Every decision runs through the same maker-checker governance either way.
          </p>
        </div>

        <FooterColumn title="Platform">
          {FOOTER_PLATFORM_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="text-sm text-slate-600 hover:text-slate-900">
                {link.label}
              </Link>
            </li>
          ))}
        </FooterColumn>

        <FooterColumn title="Waqf Fund types">
          {WAQF_TYPE_SLUGS.map((slug) => (
            <li key={slug}>
              <Link href={`/waqf-types/${slug}`} className="text-sm text-slate-600 hover:text-slate-900">
                {WAQF_TYPE_CONTENT[slug].label}
              </Link>
            </li>
          ))}
        </FooterColumn>

        <FooterColumn title="Account">
          <li>
            <Link href="/sign-up" className="text-sm text-slate-600 hover:text-slate-900">
              Sign up
            </Link>
          </li>
          <li>
            <Link href="/sign-in" className="text-sm text-slate-600 hover:text-slate-900">
              Sign in
            </Link>
          </li>
        </FooterColumn>
      </div>

      <div className="mx-auto mt-12 max-w-6xl border-t border-slate-100 pt-6">
        <p className="text-xs text-slate-500">
          © {new Date().getFullYear()} Birr. Every governed action is recorded to an immutable audit trail.
        </p>
      </div>
    </footer>
  );
}

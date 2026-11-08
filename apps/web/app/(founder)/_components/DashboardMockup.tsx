"use client";

// The homepage hero's product shot: a desktop monitor showing the Founder
// Portal overview. Signed-out visitors have no data, so this is a static
// illustration with sample figures (the page captions it as such) — it
// never calls the API. It is drawn at a fixed 1440×900 desktop size and
// scaled to whatever width the monitor gets, so it always looks like a
// desktop screen; the real dashboard (DashboardOverview.tsx) is
// responsive and would collapse to its mobile layout inside a small frame.
// Keep the two visually in step when the real overview changes.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  IconArrowRight,
  IconBell,
  IconBriefcase,
  IconCheckCircle,
  IconClipboardCheck,
  IconClock,
  IconHeart,
  IconHome,
  IconLogOut,
  IconMessageCircle,
  IconPlus,
  IconUsers,
} from "@birr/ui";
import { GeometricPattern } from "./ui";

const DESIGN_WIDTH = 1440;

/** Monitor bezel, chin and stand around a 16:10 screen. */
export function HeroMonitor({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div className="rounded-t-[20px] bg-gradient-to-b from-[#1c2120] to-[#111514] p-2.5 shadow-[0_40px_80px_-30px_rgba(4,22,18,0.65)] ring-1 ring-inset ring-white/5 sm:p-3.5">
        {children}
      </div>
      <div className="flex h-7 items-center justify-center rounded-b-[20px] bg-gradient-to-b from-[#e8ebea] to-[#cdd3d1] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:h-10">
        <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-b from-[#b9c0be] to-[#9aa3a0]" />
      </div>
      <div
        className="mx-auto h-10 w-[17%] bg-gradient-to-r from-[#aab1af] via-[#e4e8e7] to-[#aab1af] sm:h-[72px]"
        style={{ clipPath: "polygon(9% 0, 91% 0, 100% 100%, 0 100%)" }}
      />
      <div className="mx-auto h-3 w-1/3 rounded-b-xl rounded-t-sm bg-gradient-to-b from-[#e9eceb] to-[#a9b0ae] shadow-[0_22px_34px_-14px_rgba(8,39,32,0.55)]" />
    </div>
  );
}

/** The screen: a desktop-size overview scaled to the screen's width. */
export function DashboardMockup() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / DESIGN_WIDTH);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      role="img"
      aria-label="The Birr Founder Portal overview, shown with sample data: amount endowed, how the endowment is earmarked across causes, waqf funds, and items needing attention."
      className="relative aspect-[16/10] overflow-hidden rounded-md bg-slate-50"
    >
      <div aria-hidden="true" className="absolute left-0 top-0 origin-top-left" style={{ width: DESIGN_WIDTH, transform: `scale(${scale})` }}>
        <MockOverview />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(118deg,rgba(255,255,255,0.08)_0%,transparent_38%)]" />
    </div>
  );
}

const SAMPLE_EARMARKS = [
  { name: "Education", pct: 40, color: "#124c3d" },
  { name: "Healthcare", pct: 25, color: "#248f72" },
  { name: "Maternal health", pct: 20, color: "#c48a1b" },
  { name: "Relief", pct: 15, color: "#aee1d1" },
];

function Donut({ size }: { size: number }) {
  const r = size * 0.377;
  const c = 2 * Math.PI * r;
  // Each arc starts where the previous ones end — computed up front rather
  // than by mutating a running total during render.
  const arcs = SAMPLE_EARMARKS.map((e, i) => ({
    ...e,
    len: (e.pct / 100) * c,
    start: (SAMPLE_EARMARKS.slice(0, i).reduce((s, x) => s + x.pct, 0) / 100) * c,
  }));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef3f1" strokeWidth={size * 0.116} />
      {arcs.map((a) => (
        <circle
          key={a.name}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={a.color}
          strokeWidth={size * 0.116}
          strokeDasharray={`${Math.max(0, a.len - 2)} ${c}`}
          strokeDashoffset={-a.start}
        />
      ))}
    </svg>
  );
}

function NavItem({ icon, label, active = false, badge }: { icon: ReactNode; label: string; active?: boolean; badge?: number }) {
  return (
    <div
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium ${
        active ? "bg-white/10 text-white" : "text-primary-100/75"
      }`}
    >
      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent-400" />}
      <span className={active ? "text-accent-300" : "text-primary-300"}>{icon}</span>
      {label}
      {badge !== undefined && (
        <span className="ml-auto rounded-full bg-accent-400 px-2 text-[11px] font-bold leading-5 text-accent-950">{badge}</span>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, sub, gold = false }: { icon: ReactNode; label: string; value: string; sub: string; gold?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${gold ? "bg-accent-50 text-accent-700" : "bg-primary-50 text-primary-700"}`}>{icon}</span>
        <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <p className="mt-3 font-display text-[28px] font-medium tracking-tight text-slate-900">{value}</p>
      <p className="text-[13px] text-slate-500">{sub}</p>
    </div>
  );
}

function MockOverview() {
  const ic = "h-[18px] w-[18px]";
  return (
    <div className="grid min-h-[900px] grid-cols-[256px_1fr] bg-slate-50 font-sans text-[14px] text-slate-900">
      <aside className="relative flex flex-col overflow-hidden bg-gradient-to-b from-primary-950 via-primary-900 to-primary-950">
        <GeometricPattern className="pointer-events-none absolute inset-x-0 bottom-0 h-80 w-full text-accent-400/[0.08] [mask-image:linear-gradient(to_top,black,transparent)]" />
        <div className="relative flex h-14 items-center gap-2.5 border-b border-white/10 px-6">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-500 font-display text-[16px] font-bold text-primary-950">B</span>
          <div>
            <p className="text-[15px] font-semibold leading-tight text-white">Birr</p>
            <p className="text-[10px] font-semibold uppercase leading-tight tracking-[0.14em] text-accent-400">Founder Portal</p>
          </div>
        </div>
        <div className="relative flex-1 px-4 py-5">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-300/60">Endowment</p>
          <NavItem active icon={<IconHome className={ic} />} label="Overview" />
          <NavItem icon={<IconBriefcase className={ic} />} label="Portfolio" />
          <NavItem icon={<IconHeart className={ic} />} label="Impact" />
          <p className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-300/60">Collaborate</p>
          <NavItem icon={<IconMessageCircle className={ic} />} label="Messages" badge={2} />
          <NavItem icon={<IconUsers className={ic} />} label="Team" />
          <p className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-300/60">Records</p>
          <NavItem icon={<IconClock className={ic} />} label="Activity" />
        </div>
        <div className="relative flex items-center gap-3 border-t border-white/10 p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent-300 to-accent-500 text-[12px] font-bold text-accent-950">IM</span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-white">Ibrahim Musa</p>
            <p className="text-[12px] text-primary-200/70">Ibrahim Family Foundation</p>
          </div>
          <IconLogOut className="h-[18px] w-[18px] text-primary-200/70" />
        </div>
      </aside>

      <main className="min-w-0">
        <div className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-9">
          <p className="text-[14px] text-slate-500">
            Founder Portal <span className="mx-2 text-slate-300">/</span>
            <span className="font-semibold text-slate-900">Overview</span>
          </p>
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500">
            <IconBell className="h-[17px] w-[17px]" />
            <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-accent-500 ring-2 ring-white" />
          </span>
        </div>

        <div className="space-y-5 px-9 py-7">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary-700">Sunday, 18 October</p>
              <p className="mt-2 font-display text-[36px] font-medium tracking-tight">Good evening, Ibrahim</p>
              <p className="mt-1 text-[14px] text-slate-600">
                Birr serves as Mutawalli (trustee) for <span className="font-medium text-slate-800">the Ibrahim Family Foundation</span> and its 2 waqf funds.
              </p>
            </div>
            <div className="flex gap-2.5">
              <span className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-[14px] font-semibold text-slate-700">
                <IconMessageCircle className="h-4 w-4" />
                Message Birr
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2.5 text-[14px] font-semibold text-white">
                <IconPlus className="h-4 w-4" />
                Add Waqf Fund
              </span>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-5">
            <section className="relative col-span-3 overflow-hidden rounded-2xl bg-gradient-to-br from-primary-950 via-primary-900 to-primary-700 p-7 text-white">
              <GeometricPattern className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 text-white/[0.07] [mask-image:linear-gradient(to_left,black,transparent)]" />
              <div className="relative">
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent-300">Endowed to date</p>
                <p className="mt-3 font-display text-[52px] font-medium leading-none tracking-tight">₦29,200,000</p>
                <p className="mt-2.5 text-[14px] text-primary-100/80">of ₦35,000,000 declared across 2 funds</p>
                <div className="mt-6 flex h-2.5 overflow-hidden rounded-full bg-white/10">
                  <span className="h-full bg-accent-500" style={{ width: "71.4%" }} />
                  <span className="h-full bg-primary-300" style={{ width: "12%" }} />
                </div>
                <div className="mt-3 flex items-center gap-5 text-[13px] text-primary-100/85">
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent-500" />Investment · ₦25,000,000</span>
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-primary-300" />Project · ₦4,200,000</span>
                  <span className="ml-auto font-semibold text-white">83% funded</span>
                </div>
              </div>
            </section>
            <section className="col-span-2 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[14px] font-semibold">How your endowment is earmarked</p>
                <span className="text-[12px] font-semibold text-primary-700">Manage</span>
              </div>
              <div className="mt-4 flex items-center gap-6">
                <div className="relative">
                  <Donut size={138} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-display text-[26px] font-medium leading-none">4</span>
                    <span className="text-[11px] text-slate-500">causes</span>
                  </div>
                </div>
                <ul className="flex-1 space-y-2.5">
                  {SAMPLE_EARMARKS.map((e) => (
                    <li key={e.name} className="flex items-center gap-2.5 text-[13px] text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: e.color }} />
                      {e.name}
                      <span className="ml-auto font-semibold tabular-nums text-slate-900">{e.pct}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          <div className="grid grid-cols-4 gap-5">
            <Kpi icon={<IconCheckCircle className={ic} />} label="Active funds" value="2" sub="of 2 established" />
            <Kpi icon={<IconHeart className={ic} />} label="Causes supported" value="4" sub="across 2 funds" />
            <Kpi icon={<IconClipboardCheck className={ic} />} label="Distributed" value="₦1,860,000" sub="paid to beneficiaries" />
            <Kpi gold icon={<IconBriefcase className={ic} />} label="Left to fund" value="₦5,800,000" sub="Kano Maternity Clinic" />
          </div>

          <div className="grid grid-cols-5 gap-5">
            <section className="col-span-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <p className="text-[14px] font-semibold">Your waqf funds</p>
                <span className="flex items-center gap-1 text-[12px] font-semibold text-primary-700">Portfolio <IconArrowRight className="h-3.5 w-3.5" /></span>
              </div>
              {[
                { name: "Ibrahim Family Waqf", meta: "Investment fund · Ibrahim Family Foundation", status: "Active", raised: "₦25,000,000", of: "₦25,000,000", pct: 100 },
                { name: "Kano Maternity Clinic", meta: "Project fund · Installments", status: "Active", raised: "₦4,200,000", of: "₦10,000,000", pct: 42 },
              ].map((f) => (
                <div key={f.name} className="flex items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                    <IconCheckCircle className={ic} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold">{f.name}</span>
                      <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700 ring-1 ring-inset ring-primary-100">{f.status}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-slate-500">{f.meta}</p>
                    <div className="mt-2.5 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-primary-600" style={{ width: `${f.pct}%` }} />
                      </div>
                      <span className="text-[12px] tabular-nums text-slate-600">
                        <span className="font-semibold text-slate-900">{f.raised}</span> of {f.of}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </section>
            <section className="col-span-2 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <p className="text-[14px] font-semibold">Needs your attention</p>
                <span className="rounded-full bg-accent-100 px-2 text-[11px] font-bold leading-5 text-accent-700">2</span>
              </div>
              {[
                { t: "₦5,800,000 left to fund", d: "Kano Maternity Clinic · instalment plan", cta: "Top up", gold: true },
                { t: "2 new messages", d: "From your Mutawalli Officer", cta: "Read", gold: false },
              ].map((a) => (
                <div key={a.t} className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${a.gold ? "bg-accent-50 text-accent-700" : "bg-primary-50 text-primary-700"}`}>
                    {a.gold ? <IconBriefcase className="h-4 w-4" /> : <IconMessageCircle className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold">{a.t}</p>
                    <p className="text-[12px] text-slate-500">{a.d}</p>
                  </div>
                  <span className="text-[13px] font-semibold text-primary-700">{a.cta}</span>
                </div>
              ))}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

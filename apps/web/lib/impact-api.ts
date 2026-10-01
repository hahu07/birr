// Server-side client for the public GET /impact/summary endpoint — the
// homepage's Impact section. Real, aggregate figures only (see the
// backend's ImpactService for exactly what is and isn't counted).
// Revalidated every few minutes; an unreachable backend degrades to
// "no section" rather than an error or a made-up number.
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL;

export interface CurrencyTotal {
  currency: string;
  amount: string;
}

export interface ImpactSummary {
  giftsReceived: number;
  givenByCurrency: CurrencyTotal[];
  fundsAndCampaigns: number;
  paidOutByCurrency: CurrencyTotal[];
}

export async function getImpactSummary(): Promise<ImpactSummary | null> {
  if (!BACKEND_URL) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/impact/summary`, { next: { revalidate: 300 } });
    return res.ok ? ((await res.json()) as ImpactSummary) : null;
  } catch {
    return null;
  }
}

export interface ImpactPhoto {
  imageUrl: string;
  altText: string;
  credit: string | null;
}

/** Approved photos for the Impact frames, newest first. Empty — never throws — if the backend can't be reached. */
export async function getImpactPhotos(limit = 4): Promise<ImpactPhoto[]> {
  if (!BACKEND_URL) return [];
  try {
    const res = await fetch(`${BACKEND_URL}/impact/photos?limit=${limit}`, { next: { revalidate: 300 } });
    return res.ok ? ((await res.json()) as ImpactPhoto[]) : [];
  } catch {
    return [];
  }
}

/**
 * Below this many confirmed gifts the section stays hidden: a row of tiny
 * numbers undersells a young platform more than an absent section does,
 * and a handful of test-sized gifts isn't a story yet. Server-side only
 * (set IMPACT_MIN_GIFTS in the web app's environment to tune it without a
 * code change); defaults to 10.
 */
export function impactMinGifts(): number {
  const parsed = Number.parseInt(process.env.IMPACT_MIN_GIFTS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
}

/** The summary only if there's enough real giving to show — otherwise null, and the section doesn't render. */
export function visibleImpact(summary: ImpactSummary | null): ImpactSummary | null {
  return summary && summary.giftsReceived >= impactMinGifts() ? summary : null;
}

/** "₦141M", "$12.3K" — compact, one decimal at most. Non-ISO codes (USDC, USDT) fall back to "USDC 4.1K". */
export function formatCompactMoney({ currency, amount }: CurrencyTotal): string {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
    return `${currency} ${compact}`;
  }
}

/** The biggest currency leads; the rest are listed small beneath it, never converted or added together. */
export function splitCurrencies(totals: CurrencyTotal[]): { lead: CurrencyTotal | null; others: CurrencyTotal[] } {
  return { lead: totals[0] ?? null, others: totals.slice(1) };
}

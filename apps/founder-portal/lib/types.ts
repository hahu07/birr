// Shared response shapes for founder-portal API calls. Kept minimal and
// local to this app rather than imported from apps/ops-console — the two
// frontends are deliberately separate deployments (see CLAUDE.md and
// next.config.mjs's comment on why).

export interface Foundation {
  id: string;
  name: string;
  purpose: string | null;
  jurisdiction: string | null;
  logoUrl: string | null;
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Waqf {
  id: string;
  foundationId: string;
  foundation: Foundation;
  name: string;
  type: "investment" | "asset" | "project" | "hybrid";
  purpose: string | null;
  jurisdiction: string;
  status: "draft" | "active" | "suspended" | "dissolved";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Contribution {
  id: string;
  waqfId: string;
  amount: string;
  currency: string;
  provider: "stripe" | "paystack" | "stablecoin";
  status: "pending" | "confirmed" | "failed";
  assetId: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

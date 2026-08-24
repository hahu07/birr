"use client";

// Waqf Fund detail — the working view for a specific fund's registered
// Assets, Causes, Beneficiaries, Investments, and Distributions.
// Registration (this page) is plain CRUD for all of these — disposal,
// criteria changes, investment changes, and distribution approval are
// always governed_actions, handled entirely on the Approval Queue page,
// never here.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../lib/api";
import { humanize, formatDate } from "../../../lib/format";
import type { Waqf } from "../../../lib/types";
import { Alert, Badge, IconBriefcase, Skeleton } from "@birr/ui";
import { LicenseStatusBanner } from "./LicenseStatusBanner";
import { CausesSection } from "./CausesSection";
import { AssetsSection } from "./AssetsSection";
import { BeneficiariesSection } from "./BeneficiariesSection";
import { InvestmentsSection } from "./InvestmentsSection";
import { DistributionsSection } from "./DistributionsSection";

const STATUS_TONE: Record<Waqf["status"], "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  draft: "neutral",
  suspended: "warning",
  closed: "danger",
};

export default function WaqfDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [waqf, setWaqf] = useState<Waqf | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by CausesSection/BeneficiariesSection whenever they create a
  // row — Distributions (and Beneficiaries, for causes) need to refetch
  // their own pickers when a sibling section adds something they
  // reference, since each section otherwise only fetches on mount.
  const [causesVersion, setCausesVersion] = useState(0);
  const [beneficiariesVersion, setBeneficiariesVersion] = useState(0);

  const load = useCallback(() => {
    apiFetchJson<Waqf>(`/waqfs/${id}`)
      .then(setWaqf)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Alert tone="danger" title="Couldn't load this waqf fund">
        {error}
      </Alert>
    );
  }

  if (!waqf) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-96" />
      </div>
    );
  }

  return (
    <div>
      <header className="mb-8">
        <Link href="/waqfs" className="text-sm text-slate-500 hover:text-primary-700">
          ← Waqf Funds
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <IconBriefcase className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{waqf.name}</h1>
              <Badge tone={STATUS_TONE[waqf.status]}>{humanize(waqf.status)}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {humanize(waqf.type)} · {waqf.jurisdiction} · Part of{" "}
              <span className="font-medium text-slate-700">{waqf.foundation.name}</span>
              {waqf.waqfDeed && <> · Deed signed {formatDate(waqf.waqfDeed.signedAt)}</>}
            </p>
          </div>
        </div>
      </header>

      <LicenseStatusBanner status={waqf.trusteeLicenseStatus} jurisdiction={waqf.jurisdiction} />

      <div className="space-y-10">
        <CausesSection waqfId={id} onChanged={() => setCausesVersion((v) => v + 1)} />
        <AssetsSection waqfId={id} />
        <BeneficiariesSection
          waqfId={id}
          causesVersion={causesVersion}
          onChanged={() => setBeneficiariesVersion((v) => v + 1)}
        />
        <InvestmentsSection waqfId={id} />
        <DistributionsSection waqfId={id} causesVersion={causesVersion} beneficiariesVersion={beneficiariesVersion} />
      </div>
    </div>
  );
}

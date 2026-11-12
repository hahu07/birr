"use client";

// Each Ramadan's Zakah al-Fitr campaign. A Mutawalli Officer drafts the
// staple, the sa' in kilograms, its Naira value per person and the dates;
// a Shariah board member approves it (zakah.fitr_campaign_approve). If the
// moon sighting moves Eid, draft a new version and have it approved.
// Closing payments early only stops money coming in, so it needs no
// second person.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, formatMoney } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { ZakahFitrCampaignRow } from "../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../_components/ProposeGovernedAction";

const STATUS_TONE = { draft: "warning", approved: "success", superseded: "neutral" } as const;

function lagosToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** For an approved campaign: is it taking payments today? */
function liveState(c: ZakahFitrCampaignRow): string {
  const today = lagosToday();
  if (today < day(c.opensOn)) return "opens soon";
  if (c.closedAt || today > day(c.closesOn)) return "payments closed";
  return "taking payments";
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function FitrCampaignsSection() {
  const { can } = useStaffSession();
  const canDraft = can("zakah.fitr_campaign_draft");
  const [campaigns, setCampaigns] = useState<ZakahFitrCampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<ZakahFitrCampaignRow[]>("/zakah/fitr-campaigns")
      .then(setCampaigns)
      .catch((err: unknown) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="mb-10">
      <SectionHeader
        title="Zakah al-Fitr"
        description="One sa' of staple food per person, paid as food or (Hanafi payers) cash. A Mutawalli Officer drafts each season; a Shariah board member approves. Payments close the day before Eid."
        actionLabel={canDraft ? (showForm ? "Cancel" : "Draft a season") : undefined}
        onAction={canDraft ? () => setShowForm((v) => !v) : undefined}
      />
      {canDraft && showForm && (
        <CampaignForm
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
      {error && (
        <Alert tone="danger" title="Couldn't load Zakah al-Fitr campaigns" className="mb-4">
          {error}
        </Alert>
      )}
      {!error && campaigns === null && <RowsSkeleton columns={4} />}
      {campaigns !== null && campaigns.length === 0 && (
        <EmptyState title="No seasons yet" description="Draft this Ramadan's campaign: the staple, how much is one sa', and its value in Naira." />
      )}
      {campaigns !== null && campaigns.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Season</TableHeaderCell>
              <TableHeaderCell>Per person</TableHeaderCell>
              <TableHeaderCell>Dates</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium text-slate-900">Ramadan {c.season}</div>
                  <div className="text-xs text-slate-500">version {c.version}</div>
                </TableCell>
                <TableCell className="text-sm text-slate-700">
                  {Number(c.kgPerPerson)}kg {c.staple} · {formatMoney(c.amountPerPerson, "NGN")}
                </TableCell>
                <TableCell className="text-xs text-slate-600">
                  Opens {formatDate(c.opensOn)}
                  <br />
                  Closes {formatDate(c.closesOn)} · Eid {formatDate(c.expectedEidOn)}
                </TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                  {c.status === "approved" && <div className="mt-1 text-xs text-slate-500">{liveState(c)}</div>}
                </TableCell>
                <TableCell>
                  <CampaignActions campaign={c} onChange={load} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function CampaignActions({ campaign: c, onChange }: { campaign: ZakahFitrCampaignRow; onChange: () => void }) {
  const { can } = useStaffSession();
  const [error, setError] = useState<string | null>(null);

  if (c.status === "draft" && can("zakah.fitr_campaign_approve")) {
    return (
      <ProposeGovernedActionButton
        permissionKey="zakah.fitr_campaign_approve"
        // The proposal carries exactly what the Shariah board approves.
        payload={{
          campaignId: c.id,
          staple: c.staple,
          kgPerPerson: String(Number(c.kgPerPerson)),
          amountPerPerson: String(Number(c.amountPerPerson)),
          opensOn: day(c.opensOn),
          expectedEidOn: day(c.expectedEidOn),
        }}
        label="Propose for Shariah approval"
        onProposed={onChange}
      />
    );
  }
  if (c.status === "approved" && !c.closedAt && liveState(c) === "taking payments" && can("zakah.fitr_close")) {
    return (
      <div>
        <Button
          variant="secondary"
          className="px-2.5 py-1.5 text-xs"
          onClick={() => {
            if (!window.confirm(`Close Zakah al-Fitr payments for Ramadan ${c.season} now? They can't be reopened.`)) return;
            apiFetchJson(`/zakah/fitr-campaigns/${c.id}/close`, { method: "POST" })
              .then(onChange)
              .catch((err: unknown) => setError(errorText(err)));
          }}
        >
          Close payments now
        </Button>
        {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      </div>
    );
  }
  return null;
}

function CampaignForm({ onSaved }: { onSaved: () => void }) {
  const [season, setSeason] = useState("");
  const [staple, setStaple] = useState("Rice");
  const [kgPerPerson, setKg] = useState("2.5");
  const [amountPerPerson, setAmount] = useState("");
  const [opensOn, setOpensOn] = useState("");
  const [expectedEidOn, setEid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/zakah/fitr-campaigns", {
        method: "POST",
        body: JSON.stringify({ season, staple, kgPerPerson, amountPerPerson: amountPerPerson.replace(/[,\s₦]/g, ""), opensOn, expectedEidOn }),
      });
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't save this season">
          {error}
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="fc-season" className="text-sm font-medium text-slate-700">Hijri year</label>
          <Input id="fc-season" required pattern="\d{4}" placeholder="1448" value={season} onChange={(e) => setSeason(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="fc-staple" className="text-sm font-medium text-slate-700">Staple food</label>
          <Input id="fc-staple" required value={staple} onChange={(e) => setStaple(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="fc-kg" className="text-sm font-medium text-slate-700">One sa&apos; (kg per person)</label>
          <Input id="fc-kg" required inputMode="decimal" value={kgPerPerson} onChange={(e) => setKg(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="fc-amount" className="text-sm font-medium text-slate-700">Value per person (₦)</label>
          <Input id="fc-amount" required inputMode="decimal" value={amountPerPerson} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="fc-opens" className="text-sm font-medium text-slate-700">Payments open</label>
          <Input id="fc-opens" type="date" required value={opensOn} onChange={(e) => setOpensOn(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="fc-eid" className="text-sm font-medium text-slate-700">Expected Eid</label>
          <Input id="fc-eid" type="date" required value={expectedEidOn} onChange={(e) => setEid(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-slate-500">Payments close automatically the day before Eid, so food can reach people before the Eid prayer.</p>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save draft"}
      </Button>
    </form>
  );
}

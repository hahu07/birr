"use client";

// Founder Requests queue — the staff-facing half of the Founder
// Portal's "view, request" (CLAUDE.md's Tech principles). Deciding a
// request never touches governed_actions itself (see FounderRequest's
// own schema comment) — this page just tracks whether staff have
// picked it up and what they did about it; if a request warrants a
// real distribution/investment/asset-disposal decision, staff go
// create that governed_action through the normal Approvals queue,
// separately. Scoped to caseload the same way Beneficiaries are (see
// FounderRequestsService.list()'s own comment).
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, humanize } from "../../../lib/format";
import type { FounderRequest, FounderRequestStatus } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconInbox,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

const STATUS_TONE: Record<FounderRequestStatus, "info" | "warning" | "success" | "danger"> = {
  pending: "info",
  in_review: "warning",
  actioned: "success",
  declined: "danger",
};

export default function FounderRequestsPage() {
  const [requests, setRequests] = useState<FounderRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetchJson<FounderRequest[]>("/founder-requests")
      .then(setRequests)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconInbox className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Founder Requests</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Structured asks from Founders — distributions, investment changes, and more — on the waqfs you're
            assigned to.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load founder requests" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && requests === null && <QueueSkeleton />}

      {!error && requests !== null && requests.length === 0 && (
        <EmptyState title="Nothing in the queue" description="Founder requests on your caseload will show up here." />
      )}

      {!error && requests !== null && requests.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Waqf</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Submitted</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {requests.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId((current) => (current === r.id ? null : r.id))}
                onDecided={load}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function RequestRow({
  request,
  expanded,
  onToggle,
  onDecided,
}: {
  request: FounderRequest;
  expanded: boolean;
  onToggle: () => void;
  onDecided: () => void;
}) {
  return (
    <>
      <TableRow>
        <TableCell>
          <span className="font-medium text-slate-900">{request.waqf.name}</span>
        </TableCell>
        <TableCell>{humanize(request.type)}</TableCell>
        <TableCell>
          <Badge tone={STATUS_TONE[request.status]}>{humanize(request.status)}</Badge>
        </TableCell>
        <TableCell className="text-slate-500">{formatDate(request.createdAt)}</TableCell>
        <TableCell>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={onToggle}>
            {expanded ? "Close" : "Review"}
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={5} className="bg-slate-50">
            <RequestDetailsPanel request={request} onDecided={onDecided} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function RequestDetailsPanel({ request, onDecided }: { request: FounderRequest; onDecided: () => void }) {
  const [reviewNote, setReviewNote] = useState(request.reviewNote ?? "");
  const [submitting, setSubmitting] = useState<FounderRequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isFinal = request.status === "actioned" || request.status === "declined";

  async function decide(status: "in_review" | "actioned" | "declined") {
    setSubmitting(status);
    setError(null);
    try {
      await apiFetchJson(`/founder-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, reviewNote: reviewNote.trim() || undefined }),
      });
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-3 py-2">
      {error && (
        <Alert tone="danger" title="Couldn't update this request">
          {error}
        </Alert>
      )}

      {request.note && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Founder's note</p>
          <p className="mt-1 text-sm text-slate-700">{request.note}</p>
        </div>
      )}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Details</p>
        <dl className="mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
          {Object.entries(request.details).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-medium text-slate-500">{humanize(key.replace(/([a-z])([A-Z])/g, "$1_$2"))}</dt>
              <dd className="text-slate-700">{typeof value === "string" ? value : JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {!isFinal && (
        <div className="space-y-1.5">
          <label htmlFor={`review-note-${request.id}`} className="text-sm font-medium text-slate-700">
            Note back to the founder (optional)
          </label>
          <Input
            id={`review-note-${request.id}`}
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            maxLength={500}
          />
        </div>
      )}

      {isFinal ? (
        request.reviewNote && (
          <p className="text-sm text-slate-600">
            <span className="font-medium text-slate-900">Decision note:</span> {request.reviewNote}
          </p>
        )
      ) : (
        <div className="flex flex-wrap gap-2">
          {request.status === "pending" && (
            <Button variant="secondary" disabled={submitting !== null} onClick={() => decide("in_review")}>
              {submitting === "in_review" ? "Marking…" : "Mark in review"}
            </Button>
          )}
          <Button disabled={submitting !== null} onClick={() => decide("actioned")}>
            {submitting === "actioned" ? "Saving…" : "Mark actioned"}
          </Button>
          <Button variant="secondary" disabled={submitting !== null} onClick={() => decide("declined")}>
            {submitting === "declined" ? "Saving…" : "Decline"}
          </Button>
        </div>
      )}
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-8 px-5 py-3.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

// AI Agents registry. Every agent-initiated action must trace back to a
// specific row here (CLAUDE.md's non-negotiable); this page is how Birr
// staff see which agents exist, what they've actually drafted, and how
// many governed_actions they've proposed (0 for every agent today — none
// has graduated). draftCount/governedActionCount/lastActiveAt are real
// counts from AiAgentsService.list(), not a fabricated readiness score —
// CLAUDE.md's graduation gate ("officers consistently act on its drafts
// without correcting them") stays a human judgment call this page
// surfaces evidence for, not one it makes automatically.
import { Fragment, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { agentNickname, formatDate, humanize, humanizePermissionKey } from "../../../lib/format";
import type { AiAgent, AiAgentDraft } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  EmptyState,
  IconChevronDown,
  IconSparkle,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

// Matches CLAUDE.md's Agentic AI graduation table exactly — static,
// not derived, since no agent has actually graduated yet. The tooltip
// carries the specific "why" (a milestone gate vs. no path at all)
// since a one-word badge can't.
const TIER: Record<string, { label: string; detail: string }> = {
  rasid: { label: "Draft-only", detail: "Graduates once officers consistently act on its drafts unedited." },
  nazim: { label: "Draft-only", detail: "May never write governed_actions at all — a triage view, not a proposal." },
  kashif: { label: "Draft-only", detail: "Graduates only if Birr wants it auto-opening a formal review case." },
  rashid: { label: "Draft-only", detail: "Blocked on Milestone 4 (investment module) plus a clean Rasid/Nazim track record." },
  rafiq: { label: "N/A — no governed_actions path", detail: "Establishment is a Founder's own action now, not something a Birr officer approves." },
  munsif: { label: "Draft-only", detail: "Blocked on Milestone 6 (beneficiary/distribution module) plus every earlier agent's clean track record." },
  bashir: { label: "Non-fiduciary", detail: "Never touches governed_actions — draft, human review, publish, always." },
};

export default function AiAgentsPage() {
  const [agents, setAgents] = useState<AiAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<AiAgent[]>("/ai-agents")
      .then((data) => {
        if (!cancelled) setAgents(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const query = search.trim().toLowerCase();
  const visibleAgents =
    agents?.filter(
      (a) => !query || agentNickname(a.name).toLowerCase().includes(query) || a.taskType.toLowerCase().includes(query),
    ) ?? [];

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-sm shadow-violet-900/25">
          <IconSparkle className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">AI Agents</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            The registry every agent-initiated action traces back to — advisory only, never a checker.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load agents" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && agents === null && <AgentsSkeleton />}

      {!error && agents !== null && agents.length === 0 && (
        <EmptyState title="No agents registered yet" description="Agents are provisioned via the backend seed script." />
      )}

      {!error && agents !== null && agents.length > 0 && (
        <Input
          placeholder="Search by agent or task type…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 max-w-xs"
        />
      )}

      {!error && agents !== null && visibleAgents.length === 0 && agents.length > 0 && (
        <p className="text-sm text-slate-500">No agents match "{search.trim()}".</p>
      )}

      {!error && visibleAgents.length > 0 && (
        // tone="violet" throughout: this table is violet's one dedicated
        // surface in the content canvas (see styles.css's documented hue
        // rationale) — without it, violet's "real semantic job" was
        // asserted in a comment but only ever visible in a 40px header
        // badge. Status uses the "info" (violet) badge tone for the
        // same reason, not "success" — an agent isn't a positive/negative
        // state, it's an AI-agent-scoped one.
        <Table tone="violet">
          <TableHead tone="violet">
            <TableRow tone="violet">
              <TableHeaderCell tone="violet">Agent</TableHeaderCell>
              <TableHeaderCell tone="violet">Task type</TableHeaderCell>
              <TableHeaderCell tone="violet">Tier</TableHeaderCell>
              <TableHeaderCell tone="violet">Drafts</TableHeaderCell>
              <TableHeaderCell tone="violet">Governed actions</TableHeaderCell>
              <TableHeaderCell tone="violet">Last active</TableHeaderCell>
              <TableHeaderCell tone="violet" className="text-right">
                Status
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleAgents.map((agent) => {
              const isExpanded = expandedId === agent.id;
              const tier = TIER[agent.name];
              return (
                <Fragment key={agent.id}>
                  <TableRow tone="violet">
                    <TableCell className="font-medium text-slate-900">
                      {agent.draftCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : agent.id)}
                          className="flex items-center gap-1.5 text-left hover:text-violet-700"
                          aria-expanded={isExpanded}
                        >
                          <IconChevronDown
                            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          />
                          {agentNickname(agent.name)}
                        </button>
                      ) : (
                        agentNickname(agent.name)
                      )}
                    </TableCell>
                    <TableCell className="text-slate-500">{humanize(agent.taskType)}</TableCell>
                    <TableCell>
                      <span title={tier?.detail}>
                        <Badge tone={tier?.label === "Non-fiduciary" ? "neutral" : "info"}>
                          {tier?.label ?? "—"}
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-500">{agent.draftCount}</TableCell>
                    <TableCell className="text-slate-500">{agent.governedActionCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-slate-500">
                      {agent.lastActiveAt ? formatDate(agent.lastActiveAt) : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge tone={agent.status === "active" ? "info" : "neutral"}>{humanize(agent.status)}</Badge>
                    </TableCell>
                  </TableRow>
                  {isExpanded && <AgentDraftsRow agentId={agent.id} />}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function AgentDraftsRow({ agentId }: { agentId: string }) {
  const [drafts, setDrafts] = useState<AiAgentDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<AiAgentDraft[]>(`/ai-agents/${agentId}/drafts`)
      .then((data) => {
        if (!cancelled) setDrafts(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return (
    <TableRow tone="violet" className="hover:bg-transparent">
      <TableCell colSpan={7} className="bg-violet-50/60 py-3">
        {error && <p className="text-xs text-red-700">Couldn&apos;t load drafts: {error}</p>}
        {!error && drafts === null && <Skeleton className="h-16 w-full" />}
        {!error && drafts !== null && (
          <div className="space-y-2">
            {drafts.map((d) => {
              const content = d.after as { summary?: string } | null;
              return (
                <div key={d.id} className="rounded-md border border-violet-200 bg-white px-3 py-2 text-xs">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-700">{humanizePermissionKey(d.action)}</span>
                    <span className="text-slate-400">{formatDate(d.createdAt)}</span>
                  </div>
                  <p className="text-slate-600">
                    {typeof content?.summary === "string" ? content.summary : JSON.stringify(d.after)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function AgentsSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-8 px-5 py-3.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

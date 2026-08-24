"use client";

// AI Agents registry — read-only. Every agent-initiated action must
// trace back to a specific row here (CLAUDE.md's non-negotiable); this
// page is how Birr staff see which agents exist and whether they're
// active, not a place to create or configure one (a new agent needs a
// generated API key handled through packages/db/prisma/seed.ts or a
// future admin flow, not a plain form here).
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../lib/api";
import { formatDate, humanize } from "../../lib/format";
import type { AiAgent } from "../../lib/types";
import {
  Alert,
  Badge,
  EmptyState,
  IconSparkle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

// Nicknames from CLAUDE.md's Agentic AI section — internal branding, not
// derived from anything the API returns. Falls back to the raw registry
// name for any agent not in this list.
const NICKNAMES: Record<string, string> = {
  rasid: "Rasid — the observer",
  nazim: "Nazim — the organizer",
  kashif: "Kashif — the revealer",
  rashid: "Rashid — the wise",
  rafiq: "Rafiq — the companion",
  munsif: "Munsif — the fair one",
  bashir: "Bashir — the herald",
};

export default function AiAgentsPage() {
  const [agents, setAgents] = useState<AiAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
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
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Agent</TableHeaderCell>
              <TableHeaderCell>Task type</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell className="text-right">Registered</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell className="font-medium text-slate-900">
                  {NICKNAMES[agent.name] ?? agent.name}
                </TableCell>
                <TableCell className="text-slate-500">{humanize(agent.taskType)}</TableCell>
                <TableCell>
                  <Badge tone={agent.status === "active" ? "success" : "neutral"}>{humanize(agent.status)}</Badge>
                </TableCell>
                <TableCell className="text-right text-slate-500">{formatDate(agent.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
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

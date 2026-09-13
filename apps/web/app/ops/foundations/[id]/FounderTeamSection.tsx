"use client";

// A Foundation can have more than one Founder attached to it (a
// co-founder invitation joins a second Founder to the same Foundation —
// see InvitationsService's own comment on co_founder invitations), and
// each Founder can itself have more than one team member. MFA is a
// property of the individual person (User), not the Founder org, so
// resetting it needs to target one specific member, not "the Founder."
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { useStaffSession } from "../../../../lib/staff-session";
import type { FounderTeamMember } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Skeleton } from "@birr/ui";
import { useLoadedResource } from "../../_components/SectionChrome";

export function FounderTeamSection({ founders }: { founders: { id: string; name: string }[] }) {
  return (
    <div className="space-y-6">
      {founders.map((founder) => (
        <FounderTeam key={founder.id} founderId={founder.id} founderName={founder.name} />
      ))}
    </div>
  );
}

function FounderTeam({ founderId, founderName }: { founderId: string; founderName: string }) {
  const { staff } = useStaffSession();
  const isAdmin = staff?.staffRole === "platform_admin";

  const {
    data: members,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<FounderTeamMember[]>(`/founders/${founderId}/members`), [founderId]);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleResetMfa(member: FounderTeamMember) {
    if (!window.confirm(`Reset two-factor authentication for ${member.user.fullName}? They'll need to set it up again.`)) {
      return;
    }
    setResettingUserId(member.user.id);
    setResetError(null);
    try {
      await apiFetchJson(`/founders/members/${member.user.id}/mfa/reset`, { method: "POST" });
      load();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setResettingUserId(null);
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{founderName} — team</p>
      {error && (
        <Alert tone="danger" title="Couldn't load this team">
          {error}
        </Alert>
      )}
      {resetError && (
        <Alert tone="danger" title="Couldn't reset two-factor authentication" className="mb-2">
          {resetError}
        </Alert>
      )}
      {!error && members === null && <Skeleton className="h-16 w-full" />}
      {!error && members !== null && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{member.user.fullName}</p>
                    <p className="text-xs text-slate-500">{member.user.email}</p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{member.permissionLevel}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={member.status === "active" ? "success" : "neutral"}>{member.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={member.user.mfaEnabled ? "success" : "neutral"}>
                      {member.user.mfaEnabled ? "2FA enrolled" : "2FA not enrolled"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {isAdmin && member.user.mfaEnabled && (
                      <Button
                        variant="secondary"
                        disabled={resettingUserId === member.user.id}
                        onClick={() => handleResetMfa(member)}
                      >
                        {resettingUserId === member.user.id ? "Resetting…" : "Reset MFA"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

// A Foundation can have more than one Founder attached to it (a
// co-founder invitation joins a second Founder to the same Foundation —
// see InvitationsService's own comment on co_founder invitations), and
// each Founder can itself have more than one team member. MFA is a
// property of the individual person (User), not the Founder org, so
// resetting it needs to target one specific member, not "the Founder."
import { apiFetchJson } from "../../../../lib/api";
import { useStaffSession } from "../../../../lib/staff-session";
import type { FounderTeamMember } from "../../../../lib/ops-types";
import { Alert, Badge, Skeleton } from "@birr/ui";
import { useLoadedResource } from "../../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";

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

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{founderName} — team</p>
      {error && (
        <Alert tone="danger" title="Couldn't load this team">
          {error}
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
                      // Not a direct reset — a Board member or Compliance
                      // officer has to approve it on the Approvals page, and
                      // the Founder is emailed once it's done.
                      <ProposeGovernedActionButton
                        permissionKey="founder.mfa_reset"
                        payload={{ userId: member.user.id }}
                        label="Request MFA reset"
                        onProposed={load}
                      />
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

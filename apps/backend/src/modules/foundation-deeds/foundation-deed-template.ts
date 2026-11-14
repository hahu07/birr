import { Foundation, Founder, Waqf } from "@birr/db";

// Bumped whenever the template wording below changes materially.
// Traceability only — the rendered deedText snapshotted onto a
// FoundationDeed row at signing time is the actual source of truth for
// what a founder agreed to; a later bump here never retroactively
// changes a past signature's meaning.
export const FOUNDATION_DEED_TEMPLATE_VERSION = "v1-2026-08";

// The joint variant: one founder signs for every co-founder, present and
// future, each of whom adopts the deed through a CoFounderDeedConsent
// (owner's decision, 2026-11-14 — "A2" in the Board note "Joint Waqf:
// Who Signs the Deed"). This wording went live at the owner's direction
// before Legal or the Shariah Supervisory Board reviewed it; a revision
// they approve gets a new version here. The single-founder text above
// is unchanged by it.
export const JOINT_FOUNDATION_DEED_TEMPLATE_VERSION = "v2-2026-11-joint";

/** The other founders of a jointly established Foundation, as of signing. Null for a single-founder deed. */
export type JointDeedParties = { coFounders: Pick<Founder, "name">[] } | null;

export function foundationDeedTemplateVersion(joint: JointDeedParties): string {
  return joint ? JOINT_FOUNDATION_DEED_TEMPLATE_VERSION : FOUNDATION_DEED_TEMPLATE_VERSION;
}

// Small and local rather than a shared package export — same posture as
// InvitationsService's own humanizeRoleKey (the only other place on the
// backend that turns an enum key into display text).
function humanize(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Fixed legal template, interpolated with Founder/Foundation facts plus
 * a snapshot of whichever Waqf Funds are active as of signing — this
 * exact rendered string is what gets stored verbatim onto
 * FoundationDeed.deedText (see that model's own comment) and never
 * changes again, even as more Waqf Funds are established under the
 * Foundation afterward.
 */
export function renderFoundationDeedText(
  foundation: Foundation,
  founder: Founder,
  activeWaqfs: Waqf[],
  joint: JointDeedParties = null,
): string {
  const founderDescription =
    founder.kind === "individual"
      ? "an individual"
      : `acting in its capacity as an institution${founder.institutionType ? ` (${humanize(founder.institutionType)})` : ""}`;

  const jurisdictionClause = foundation.jurisdiction
    ? `, established in the jurisdiction of ${foundation.jurisdiction}`
    : "";

  const fundsSchedule =
    activeWaqfs.length > 0
      ? activeWaqfs.map((w) => `  - ${w.name} — ${humanize(w.type)} — ${w.jurisdiction}`).join("\n")
      : "  None yet — this Deed takes effect prospectively as each Waqf Fund is established and funded.";

  // Built so a single-founder deed renders exactly as v1 did.
  const opening = joint
    ? `This Deed is made by ${founder.name} (the "Signing Founder"), ${founderDescription},
for themselves and on behalf of each co-founder, present and future, of
the foundation known as "${foundation.name}" (the "Foundation")${jurisdictionClause}.
In this Deed, "the Founder" means the Signing Founder and each such
co-founder, each in respect of their own contributions.`
    : `This Deed is made by ${founder.name} (the "Founder"), ${founderDescription},
in respect of the foundation known as "${foundation.name}" (the
"Foundation")${jurisdictionClause}.`;

  const coFoundersSchedule =
    joint && joint.coFounders.length > 0
      ? joint.coFounders.map((c) => `  - ${c.name}`).join("\n")
      : "  None yet — each co-founder is bound from the day they accept the statement described above.";

  const closing = joint
    ? `7. CO-FOUNDERS
The Signing Founder signs this Deed for themselves and on behalf of each
co-founder of the Foundation, present and future. Each co-founder adopts
this Deed, and dedicates their own contributions to any Waqf Fund under
the Foundation on its terms, by the statement they accept when joining
the Foundation, which Birr records with the date it was given. The
co-founders of the Foundation as of the date of this Deed are:
${coFoundersSchedule}

IN WITNESS WHEREOF, the Signing Founder has caused this Deed to be signed
below, for themselves and on behalf of each co-founder, this appointment
taking effect upon signature.`
    : `IN WITNESS WHEREOF, the Founder has caused this Deed to be signed below,
this appointment taking effect upon signature.`;

  return `
DEED OF WAQF (ISLAMIC ENDOWMENT)
DECLARATION OF TRUST AND APPOINTMENT OF MUTAWALLI

${opening}

RECITALS

A. The Founder has established the Foundation for the purpose of:
   ${foundation.purpose ?? "the general charitable and endowment purposes described by the Founder."}
B. The Founder wishes to dedicate assets in perpetuity as waqf (Islamic
   endowment) for this purpose, through one or more Waqf Funds
   established under the Foundation from time to time.
C. Birr has agreed to act as Mutawalli (trustee) over each such Waqf
   Fund on the terms set out below.

1. DECLARATION OF WAQF
The Founder hereby irrevocably and perpetually dedicates, and shall be
deemed to dedicate automatically upon establishment, all assets
contributed to any Waqf Fund now or hereafter established under the
Foundation, as waqf, to be held, invested, and administered exclusively
for the charitable and beneficiary purposes stated for each such Waqf
Fund, in accordance with Shariah principles governing waqf.

2. APPOINTMENT OF MUTAWALLI
Birr is hereby appointed as Mutawalli (trustee) over each Waqf Fund
established under the Foundation, with full authority and fiduciary
duty to safeguard, invest, and administer the endowed assets of each
such Waqf Fund in accordance with: (a) applicable Shariah governance
standards; (b) the regulatory requirements of the jurisdiction stated
for each Waqf Fund; and (c) Birr's own internal governance and
maker-checker controls over all ongoing decisions affecting the Waqf
Fund. This appointment takes effect, for each Waqf Fund, upon that Waqf
Fund's establishment and funding, and requires no further signature
from the Founder.

3. IRREVOCABILITY AND PERPETUITY
The dedication of assets as waqf under this Deed is irrevocable. Once
assets are contributed to a Waqf Fund under the Foundation, neither the
Founder nor its successors may reclaim them; they remain dedicated in
perpetuity to the stated purpose.

4. WAQF FUNDS ESTABLISHED AS OF THIS DEED
As of the date of this Deed, the following Waqf Fund(s) have been
established under the Foundation and are covered by this appointment:
${fundsSchedule}

5. FUTURE WAQF FUNDS
This Deed extends automatically to every Waqf Fund the Founder
establishes under the Foundation after the date of this Deed, without
requiring a further deed or signature.

6. GOVERNING PRINCIPLES
This Deed and each Waqf Fund it covers shall be governed by Shariah
principles applicable to waqf, and by the laws and regulations of the
jurisdiction stated for that Waqf Fund.

${closing}
`.trim();
}

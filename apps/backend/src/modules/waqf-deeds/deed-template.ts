import { Foundation, Founder, Waqf } from "@birr/db";

// Bumped whenever the template wording below changes materially.
// Traceability only — the rendered deedText snapshotted onto a WaqfDeed
// row at signing time is the actual source of truth for what a founder
// agreed to; a later bump here never retroactively changes a past
// signature's meaning.
export const DEED_TEMPLATE_VERSION = "v1-2026-08";

/**
 * Fixed legal template, interpolated with fund-specific facts. This
 * exact rendered string is what gets snapshotted verbatim onto
 * WaqfDeed.deedText — see that model's own comment.
 */
export function renderDeedText(waqf: Waqf, foundation: Foundation, founder: Founder): string {
  return `
DEED OF WAQF (ISLAMIC ENDOWMENT)

This deed records the establishment of the waqf fund named
"${waqf.name}" (the "Waqf Fund"), of type ${waqf.type}, established
under the foundation "${foundation.name}" by ${founder.name} (the
"Founder"), in the jurisdiction of ${waqf.jurisdiction}.

${waqf.purpose ? `Purpose: ${waqf.purpose}\n\n` : ""}By signing this deed, the Founder irrevocably dedicates the assets
contributed to the Waqf Fund as waqf (Islamic endowment), and confirms
that Birr is appointed as Mutawalli (trustee) over the Waqf Fund, to
administer it in accordance with applicable Shariah governance
standards and the jurisdiction's regulatory requirements.

This appointment takes effect upon signature below.
`.trim();
}

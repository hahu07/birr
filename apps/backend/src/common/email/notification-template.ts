// One shared branded shell for every transactional email Birr sends —
// sign-up verification, invitations, and every notification type below
// all render through this instead of each hand-rolling its own inline
// <p> tags. Colors match the actual app's design tokens
// (packages/ui/src/styles.css: --color-primary-950/900/600,
// --color-accent-500) so an email and the product itself read as the
// same brand, not two different-looking things.
//
// Deliberately table-based, inline-styled HTML — no external stylesheet,
// no web fonts, no client-side anything. Email clients strip <style>
// blocks and ignore most modern CSS; this is the actual constraint set
// email templates live under, not a stylistic choice.

export interface EmailTemplateInput {
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export function renderEmailTemplate({ heading, bodyHtml, ctaLabel, ctaUrl }: EmailTemplateInput): string {
  const cta =
    ctaLabel && ctaUrl
      ? `
        <tr>
          <td style="padding: 8px 40px 32px;">
            <a href="${ctaUrl}"
               style="display: inline-block; background-color: #c48a1b; color: #082720; font-weight: 600;
                      font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 6px;">
              ${ctaLabel}
            </a>
          </td>
        </tr>`
      : "";

  return `
<!DOCTYPE html>
<html>
  <body style="margin: 0; padding: 0; background-color: #f1f5f2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f2; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0"
                 style="background-color: #ffffff; border-radius: 12px; overflow: hidden; max-width: 560px; width: 100%;">
            <tr>
              <td style="background-color: #082720; padding: 28px 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width: 36px; height: 36px; background-color: #dea52a; border-radius: 50%; text-align: center; vertical-align: middle;">
                      <span style="color: #082720; font-weight: 700; font-size: 16px; line-height: 36px;">B</span>
                    </td>
                    <td style="padding-left: 12px; vertical-align: middle;">
                      <span style="color: #ffffff; font-weight: 600; font-size: 16px;">Birr</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 36px 40px 8px;">
                <h1 style="margin: 0; color: #113f33; font-size: 20px; font-weight: 600; line-height: 1.35;">
                  ${heading}
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 40px 8px; color: #3f4b46; font-size: 14px; line-height: 1.6;">
                ${bodyHtml}
              </td>
            </tr>
            ${cta}
            <tr>
              <td style="padding: 24px 40px 32px; border-top: 1px solid #eef1ee;">
                <p style="margin: 0; color: #8a938e; font-size: 12px; line-height: 1.5;">
                  This is an automated message from Birr, digital trustee for Islamic waqf. If you weren't
                  expecting this, you can safely ignore it.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

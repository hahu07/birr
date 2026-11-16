/**
 * The WhatsApp message templates Birr sends (2026-11-16). Business-started
 * WhatsApp messages from a production sender must use a template Meta has
 * approved; free text only works in Twilio's sandbox, or within 24 hours of
 * the person messaging Birr. Each template here is submitted once in
 * Twilio's Content Template Builder; once Meta approves it, its content SID
 * (HX…) goes in Platform Settings → Twilio, and every message of that kind
 * is sent through it. docs/whatsapp-templates.md is the submission guide.
 *
 * Kept deliberately few and specific: Meta rejects templates that are
 * mostly variables, start or end with one, or put two side by side.
 */
export const WHATSAPP_TEMPLATES = {
  verification_code: {
    setting: "TEMPLATE_VERIFICATION_CODE",
    category: "Authentication",
    // Meta's fixed authentication format, with the security note and expiry.
    body: "{{1}} is your verification code. For your security, do not share this code. This code expires in 10 minutes.",
    variables: [{ name: "code", sample: "482913" }],
  },
  gift_receipt: {
    setting: "TEMPLATE_GIFT_RECEIPT",
    category: "Utility",
    body: "Thank you for your gift to Birr.\n\nWe received {{1}} for {{2}}.\n\nReceipt reference: {{3}}\n\n— Birr, a digital trustee for Islamic waqf",
    variables: [
      { name: "amount", sample: "₦10,000.00" },
      { name: "what it was given to", sample: "Ramadan Relief Vault (Food parcels)" },
      { name: "reference", sample: "3f2c9a1e-5b7d-4e2a-9c1f-6d8e2b4a7c90" },
    ],
  },
  zakah_receipt: {
    setting: "TEMPLATE_ZAKAH_RECEIPT",
    category: "Utility",
    body: "Your zakah payment to Birr is received.\n\nWe received {{1}}. All of your zakah goes to people eligible to receive it.\n\nReceipt reference: {{2}}\n\n— Birr, a digital trustee for Islamic waqf",
    variables: [
      { name: "what was received", sample: "₦95,000.00 of zakah, and ₦1,548.23 you added to cover the processing fee" },
      { name: "reference", sample: "3f2c9a1e-5b7d-4e2a-9c1f-6d8e2b4a7c90" },
    ],
  },
  zakah_refund_update: {
    setting: "TEMPLATE_ZAKAH_REFUND_UPDATE",
    category: "Utility",
    body: "An update on your zakah refund from Birr:\n\n{{1}}\n\nRefund reference: {{2}}\n\n— Birr, a digital trustee for Islamic waqf",
    variables: [
      { name: "the update", sample: "Birr will refund ₦12,000.00 to your account ending 6789." },
      { name: "reference", sample: "3f2c9a1e-5b7d-4e2a-9c1f-6d8e2b4a7c90" },
    ],
  },
  monthly_gift_update: {
    setting: "TEMPLATE_MONTHLY_GIFT_UPDATE",
    category: "Utility",
    body: "An update on your monthly giving with Birr.\n\n*{{1}}*\nDetails: {{2}}\n\nManage it here: {{3}}\n\n— Birr, a digital trustee for Islamic waqf",
    variables: [
      { name: "title", sample: "Your next monthly gift" },
      { name: "details", sample: "On 15 December we'll charge ₦10,000 to Ramadan Relief to your Visa card ending 4081." },
      { name: "link", sample: "https://birrwaqf.org/giving/manage/abc123" },
    ],
  },
  account_notice: {
    setting: "TEMPLATE_ACCOUNT_NOTICE",
    category: "Utility",
    body: "You have a new notice from Birr.\n\n*{{1}}*\nDetails: {{2}}\n\nView it in Birr: {{3}}\n\n— Birr, a digital trustee for Islamic waqf",
    variables: [
      { name: "title", sample: "A proposal needs your approval" },
      { name: "details", sample: "A Mutawalli Officer proposed approving a distribution of ₦250,000.00." },
      { name: "link", sample: "https://birrwaqf.org/ops/governed-actions" },
    ],
  },
} as const;

export type WhatsAppTemplateKey = keyof typeof WHATSAPP_TEMPLATES;

/** Twilio's WhatsApp sandbox sender: free text works there, so templates are optional. */
export const TWILIO_SANDBOX_NUMBER = "+14155238886";

/**
 * A value as WhatsApp accepts it in a template: no line breaks or tabs, no
 * runs of more than three spaces, never empty, and short enough to fit.
 */
export function templateValue(value: string): string {
  const clean = value
    .replace(/[\r\n\t]+/g, " · ")
    .replace(/ {4,}/g, "   ")
    .replace(/(?: · )+/g, " · ")
    .replace(/^[\s·]+|[\s·]+$/g, "");
  const short = clean.length > 900 ? `${clean.slice(0, 899)}…` : clean;
  return short || "—";
}

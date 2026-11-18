import { WHATSAPP_TEMPLATES } from "../whatsapp/whatsapp-templates";
export interface ProviderFieldSpec {
  key: string;
  label: string;
  /** true = masked in the dashboard, shown only as a last-4-chars preview. false = plain config value (e.g. a from-address), safe to show in full. */
  secret: boolean;
  /** Why a value can't be saved, or null when it's fine. SettingsService.set() refuses a value this rejects, so a typo is caught when it's saved rather than breaking every later use of the field. */
  validate?: (value: string) => string | null;
}

// Resend accepts "email@example.com" or "Name <email@example.com>". A
// from-address saved without its closing ">" (2026-09-29) made Resend
// reject every email Birr sent, sign-up verification included, until
// someone noticed.
const EMAIL = "[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+";
const FROM_ADDRESS = new RegExp(`^(?:${EMAIL}|[^<>]*[^<>\\s] <${EMAIL}>)$`);

export function validateEmail(value: string): string | null {
  return new RegExp(`^${EMAIL}$`).test(value) ? null : 'Use "email@example.com".';
}

/** A Twilio Content template SID: "HX" and 32 hex characters. */
export function validateContentSid(value: string): string | null {
  return /^HX[0-9a-f]{32}$/i.test(value) ? null : 'Use the template\'s content SID from Twilio, like "HX" followed by 32 letters and digits.';
}

export function validateFromAddress(value: string): string | null {
  return FROM_ADDRESS.test(value) ? null : 'Use "email@example.com" or "Name <email@example.com>".';
}

// Drives both the Platform Settings GET listing and PUT/DELETE
// validation (an unknown provider/key pair is rejected). The env var
// each field falls back to is always `<PROVIDER>_<KEY>` uppercased,
// matching the naming convention already used throughout .env/.env.example
// (e.g. provider "stripe", key "SECRET_KEY" -> STRIPE_SECRET_KEY).
export const PROVIDER_FIELDS: Record<string, ProviderFieldSpec[]> = {
  stripe: [
    { key: "SECRET_KEY", label: "Secret key", secret: true },
    { key: "WEBHOOK_SECRET", label: "Webhook signing secret", secret: true },
  ],
  paystack: [
    { key: "SECRET_KEY", label: "Secret key", secret: true },
    { key: "WEBHOOK_SECRET", label: "Webhook signing secret", secret: true },
    // The Paystack subaccount (ACCT_...) tied to Birr's separate zakah
    // bank account. Zakah payments are refused until this is set, so
    // zakah never settles into the main account (owner's decision,
    // 2026-11-11).
    { key: "ZAKAH_SUBACCOUNT_CODE", label: "Zakah subaccount code (ACCT_…)", secret: false },
    // A waqf programme's gifts settle into its own subaccount, set on the
    // programme by an approved waqf_programme.subaccount_set (two people;
    // 2026-11-19), not here. The old single clinic code is gone.
  ],
  // Env var prefix is COINBASE_COMMERCE_ (matches .env's existing
  // COINBASE_COMMERCE_API_KEY/COINBASE_COMMERCE_WEBHOOK_SECRET), not
  // STABLECOIN_ — see envVarName() below for the one exception this
  // requires to the otherwise-uniform <PROVIDER>_<KEY> convention.
  stablecoin: [
    { key: "API_KEY", label: "API key", secret: true },
    { key: "WEBHOOK_SECRET", label: "Webhook signing secret", secret: true },
  ],
  resend: [
    { key: "API_KEY", label: "API key", secret: true },
    { key: "FROM_ADDRESS", label: "From address", secret: false, validate: validateFromAddress },
  ],
  twilio: [
    { key: "ACCOUNT_SID", label: "Account SID", secret: true },
    { key: "AUTH_TOKEN", label: "Auth token", secret: true },
    { key: "WHATSAPP_FROM_NUMBER", label: "WhatsApp from number", secret: false },
    // Approved WhatsApp templates (2026-11-16; docs/whatsapp-templates.md).
    // Required on a real sender; the sandbox sends plain text without them.
    ...Object.values(WHATSAPP_TEMPLATES).map((t) => ({
      key: t.setting,
      label: `WhatsApp template SID — ${t.setting.replace(/^TEMPLATE_/, "").toLowerCase().replace(/_/g, " ")}`,
      secret: false,
      validate: validateContentSid,
    })),
  ],
  openai: [{ key: "API_KEY", label: "API key", secret: true }],
  replicate: [{ key: "API_KEY", label: "API key", secret: true }],
  // Not a real vendor — a pseudo-provider reusing this same generic
  // storage/audit/UI mechanism to hold the one "which image provider is
  // active" switch (see ImageGenerationService), rather than inventing
  // a second settings concept for one string. Valid values today:
  // "openai" or "replicate".
  image_generation: [{ key: "ACTIVE_PROVIDER", label: "Active image provider (openai or replicate)", secret: false }],
  // Also not a vendor: how a founder reaches Birr without signing in. The
  // notice to a primary contact reported unable to act gives these, so
  // they can object even if they've lost access (owner's decision,
  // 2026-11-16); the email address is also that notice's reply-to.
  support: [
    { key: "CONTACT_EMAIL", label: "Contact email founders can write to", secret: false, validate: validateEmail },
    { key: "CONTACT_PHONE", label: "Contact phone founders can call (e.g. +234 …)", secret: false },
  ],
};

const ENV_PREFIX_OVERRIDES: Record<string, string> = {
  stablecoin: "COINBASE_COMMERCE",
};

export function envVarName(provider: string, key: string): string {
  const prefix = ENV_PREFIX_OVERRIDES[provider] ?? provider.toUpperCase();
  return `${prefix}_${key}`;
}

export function isKnownProviderField(provider: string, key: string): boolean {
  return Boolean(PROVIDER_FIELDS[provider]?.some((f) => f.key === key));
}

/** The field's own validation message for this value, prefixed with its label, or null when it's fine. */
export function providerFieldValueError(provider: string, key: string, value: string): string | null {
  const field = PROVIDER_FIELDS[provider]?.find((f) => f.key === key);
  const problem = field?.validate?.(value) ?? null;
  return problem && `${field!.label}: ${problem}`;
}

export interface ProviderFieldSpec {
  key: string;
  label: string;
  /** true = masked in the dashboard, shown only as a last-4-chars preview. false = plain config value (e.g. a from-address), safe to show in full. */
  secret: boolean;
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
    { key: "FROM_ADDRESS", label: "From address", secret: false },
  ],
  twilio: [
    { key: "ACCOUNT_SID", label: "Account SID", secret: true },
    { key: "AUTH_TOKEN", label: "Auth token", secret: true },
    { key: "WHATSAPP_FROM_NUMBER", label: "WhatsApp from number", secret: false },
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

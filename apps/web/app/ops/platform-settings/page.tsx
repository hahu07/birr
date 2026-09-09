"use client";

// platform_admin-only page — the backend independently enforces this via
// StaffRoleGuard/@RequiresStaffRole on the write endpoints (see
// apps/backend/src/modules/platform-settings/platform-settings.controller.ts);
// this page also hides itself for other roles as a UX nicety, not the
// security boundary. Never round-trips a plaintext secret back from the
// backend — GET returns only a masked last-4-chars preview, and a field
// must be fully retyped to change it (see PlatformSettingField).
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { useStaffSession } from "../../../lib/staff-session";
import { formatDate } from "../../../lib/format";
import type { PlatformSettingField, PlatformSettings } from "../../../lib/ops-types";
import { Alert, Button, Card, Input, PasswordInput, Skeleton } from "@birr/ui";

const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Stripe",
  paystack: "Paystack",
  stablecoin: "Stablecoin gateway",
  resend: "Resend (email)",
  twilio: "Twilio (WhatsApp)",
  openai: "OpenAI (image generation)",
  replicate: "Replicate (image generation)",
  image_generation: "Image generation — active provider",
};

export default function PlatformSettingsPage() {
  const { staff } = useStaffSession();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<PlatformSettings>("/platform-settings")
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdmin = staff?.staffRole === "platform_admin";

  return (
    <div>
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Platform Settings</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Provider credentials</h1>
        <p className="mt-1 text-sm text-slate-500">
          Stripe, Paystack, the stablecoin gateway, Resend, and Twilio credentials — configured here take effect
          immediately, no redeploy needed. A value not set here falls back to this environment's own configuration.
        </p>
      </header>

      {!isAdmin && staff && (
        <Alert tone="danger" title="platform_admin only" className="mb-6">
          Your role ({staff.staffRole}) can't view or change these — reach out to a platform admin.
        </Alert>
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load Platform Settings">
          {error}
        </Alert>
      )}

      {!error && !settings && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {!error && settings && isAdmin && (
        <div className="space-y-6">
          {Object.entries(settings).map(([provider, { fields }]) => (
            <ProviderCard
              key={provider}
              provider={provider}
              label={PROVIDER_LABELS[provider] ?? provider}
              fields={fields}
              onChanged={(next) => setSettings((prev) => (prev ? { ...prev, [provider]: { fields: next } } : prev))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  label,
  fields,
  onChanged,
}: {
  provider: string;
  label: string;
  fields: PlatformSettingField[];
  onChanged: (fields: PlatformSettingField[]) => void;
}) {
  return (
    <Card>
      <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="space-y-5">
        {fields.map((field) => (
          <FieldRow
            key={field.key}
            provider={provider}
            field={field}
            onChanged={(next) => onChanged(fields.map((f) => (f.key === field.key ? next : f)))}
          />
        ))}
      </div>
    </Card>
  );
}

function FieldRow({
  provider,
  field,
  onChanged,
}: {
  provider: string;
  field: PlatformSettingField;
  onChanged: (field: PlatformSettingField) => void;
}) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(!field.configured);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!value.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetchJson(`/platform-settings/${provider}/${field.key}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      const status = await apiFetchJson<Record<string, { fields: PlatformSettingField[] }>>("/platform-settings");
      const updated = status[provider]?.fields.find((f) => f.key === field.key);
      if (updated) onChanged(updated);
      setValue("");
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClear() {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetchJson(`/platform-settings/${provider}/${field.key}`, { method: "DELETE" });
      onChanged({ ...field, configured: false, maskedPreview: null, updatedAt: null, updatedByUser: null });
      setEditing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={`${provider}-${field.key}`} className="text-sm font-medium text-slate-700">
          {field.label}
        </label>
        {field.configured && !editing && (
          <span className="text-xs text-slate-400">
            {field.updatedByUser ? `Set by ${field.updatedByUser.fullName}` : "Set"}
            {field.updatedAt ? ` · ${formatDate(field.updatedAt)}` : ""}
          </span>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="Couldn't save" className="mb-2">
          {error}
        </Alert>
      )}

      {field.configured && !editing ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-500">
            {field.secret ? field.maskedPreview : field.maskedPreview}
          </span>
          <Button type="button" variant="secondary" onClick={() => setEditing(true)} disabled={submitting}>
            Change
          </Button>
          <Button type="button" variant="secondary" onClick={handleClear} disabled={submitting}>
            Clear
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {field.secret ? (
            <div className="flex-1">
              <PasswordInput
                id={`${provider}-${field.key}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={field.configured ? "Enter a new value to replace the current one" : "Not configured"}
              />
            </div>
          ) : (
            <Input
              id={`${provider}-${field.key}`}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={field.configured ? "Enter a new value to replace the current one" : "Not configured"}
            />
          )}
          <Button type="button" variant="primary" onClick={handleSave} disabled={submitting || !value.trim()}>
            {submitting ? "Saving…" : "Save"}
          </Button>
          {field.configured && (
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={submitting}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

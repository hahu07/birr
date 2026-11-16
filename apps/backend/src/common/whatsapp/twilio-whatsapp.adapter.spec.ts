import { TwilioWhatsAppAdapter } from "./twilio-whatsapp.adapter";
import { TWILIO_SANDBOX_NUMBER, WHATSAPP_TEMPLATES, templateValue } from "./whatsapp-templates";
import { PROVIDER_FIELDS, validateContentSid } from "../settings/provider-fields";
import type { SettingsService } from "../settings/settings.service";

// WhatsApp templates (2026-11-16): an approved template when its content SID
// is set, free text on the sandbox, and a clear refusal on a real sender
// that has no template yet.
describe("TwilioWhatsAppAdapter", () => {
  const SID = `HX${"a1".repeat(16)}`;

  function adapterWith(settings: Record<string, string | undefined>) {
    const values: Record<string, string | undefined> = { ACCOUNT_SID: "AC123", AUTH_TOKEN: "token", ...settings };
    const adapter = new TwilioWhatsAppAdapter({ get: async (_provider: string, key: string) => values[key] } as unknown as SettingsService);
    const create = jest.fn().mockResolvedValue({ sid: "SM1" });
    // Stand in for the Twilio client the adapter would build.
    Object.assign(adapter as unknown as Record<string, unknown>, { client: { messages: { create } }, cachedSid: "AC123" });
    return { adapter, create };
  }

  test("sends the approved template with its values, cleaned to WhatsApp's rules", async () => {
    const { adapter, create } = adapterWith({ WHATSAPP_FROM_NUMBER: "+2348000000000", TEMPLATE_ACCOUNT_NOTICE: SID });
    await adapter.sendTemplate("+2348031234567", "account_notice", ["A proposal\nneeds you", "Line one\n\nLine two", "https://birr.test/ops"], "fallback");
    expect(create).toHaveBeenCalledWith({
      from: "whatsapp:+2348000000000",
      to: "whatsapp:+2348031234567",
      contentSid: SID,
      contentVariables: JSON.stringify({ 1: "A proposal · needs you", 2: "Line one · Line two", 3: "https://birr.test/ops" }),
    });
  });

  test("without a template, the sandbox sender sends the free text", async () => {
    const { adapter, create } = adapterWith({ WHATSAPP_FROM_NUMBER: TWILIO_SANDBOX_NUMBER });
    await adapter.sendTemplate("+2348031234567", "gift_receipt", ["₦10,000.00", "Ramadan Relief", "ref-1"], "Thank you for your gift");
    expect(create).toHaveBeenCalledWith({ from: `whatsapp:${TWILIO_SANDBOX_NUMBER}`, to: "whatsapp:+2348031234567", body: "Thank you for your gift" });
  });

  test("without a template, a real sender refuses clearly instead of sending text WhatsApp would reject", async () => {
    const { adapter, create } = adapterWith({ WHATSAPP_FROM_NUMBER: "+2348000000000" });
    await expect(adapter.sendTemplate("+2348031234567", "zakah_receipt", ["₦95,000.00 of zakah", "ref-1"], "text")).rejects.toThrow(
      /No approved WhatsApp template for "zakah_receipt"/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("a verification code goes through the authentication template", async () => {
    const { adapter, create } = adapterWith({ WHATSAPP_FROM_NUMBER: "+2348000000000", TEMPLATE_VERIFICATION_CODE: SID });
    await adapter.sendOtp("+2348031234567", "482913");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ contentSid: SID, contentVariables: JSON.stringify({ 1: "482913" }) }));
  });
});

describe("WhatsApp templates", () => {
  const entries = Object.entries(WHATSAPP_TEMPLATES);

  test.each(entries)("%s follows Meta's rules and lines up with its variables", (_key, template) => {
    const numbers = [...template.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(template.variables.map((_, i) => i + 1));
    // Never starting or ending with a variable, nor two side by side.
    // (Authentication templates are Meta's own fixed wording, which starts with the code.)
    if (template.category !== "Authentication") expect(template.body.trim()).not.toMatch(/^\{\{\d+\}\}|\{\{\d+\}\}$/);
    expect(template.body).not.toMatch(/\}\}\s*\{\{/);
    for (const v of template.variables) expect(templateValue(v.sample)).toBe(v.sample);
  });

  test("each template has its own setting, offered in Platform Settings with a format check", () => {
    const settings = entries.map(([, t]) => t.setting);
    expect(new Set(settings).size).toBe(settings.length);
    const twilioKeys = PROVIDER_FIELDS.twilio.map((f) => f.key);
    for (const s of settings) expect(twilioKeys).toContain(s);
    expect(validateContentSid(`HX${"0f".repeat(16)}`)).toBeNull();
    expect(validateContentSid("HX123")).toMatch(/content SID/);
  });

  test("a value is made acceptable: no line breaks or tabs, no long space runs, never empty, not too long", () => {
    expect(templateValue("a\nb\tc")).toBe("a · b · c");
    expect(templateValue("a      b")).toBe("a   b");
    expect(templateValue("  \n ")).toBe("—");
    expect(templateValue("x".repeat(2000))).toHaveLength(900);
  });
});

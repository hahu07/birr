import { renderWhatsAppMessage } from "./notification-message";

describe("renderWhatsAppMessage", () => {
  test("renders icon + bold title + body, with no CTA/signature when there's no link", () => {
    const message = renderWhatsAppMessage({
      type: "contribution.confirmed",
      title: "Contribution confirmed",
      body: "Your contribution of NGN 1,500,000 was confirmed.",
    });
    expect(message).toBe("✅ *Contribution confirmed*\n\nYour contribution of NGN 1,500,000 was confirmed.");
    expect(message).not.toContain("View in Birr");
    expect(message).not.toContain("Birr | A digital trustee");
  });

  test("appends a CTA line and a branded signature when a link is given", () => {
    const message = renderWhatsAppMessage({
      type: "waqf.activated",
      title: "Test Investment Waqf Fund is now active",
      body: "Test Investment Waqf Fund has received its first contribution and is now an active Waqf Fund.",
      linkUrl: "https://birr-web.onrender.com/portfolio/b9f34530-d134-414f-8de1-98347758ce6a",
    });
    expect(message).toBe(
      [
        "🟢 *Test Investment Waqf Fund is now active*",
        "",
        "Test Investment Waqf Fund has received its first contribution and is now an active Waqf Fund.",
        "",
        "👉 View in Birr:",
        "https://birr-web.onrender.com/portfolio/b9f34530-d134-414f-8de1-98347758ce6a",
        "",
        "— *Birr* | A digital trustee for Islamic waqf",
      ].join("\n"),
    );
  });

  test("falls back to a generic bell for an unmapped type, rather than throwing or omitting the icon", () => {
    const message = renderWhatsAppMessage({ type: "some_future_type", title: "Something happened", body: "Details." });
    expect(message.startsWith("🔔 *Something happened*")).toBe(true);
  });

  // One assertion per icon so a future edit to TYPE_ICON that silently
  // drops a mapping (falling back to the generic bell) fails loudly here
  // instead of only being noticed by someone reading a live WhatsApp message.
  test.each([
    ["governed_action.proposed", "🔔"],
    ["distribution.paid", "💰"],
    ["contribution.confirmed", "✅"],
    ["contribution.failed", "⚠️"],
    ["waqf.activated", "🟢"],
    ["founder_membership.joined", "👥"],
    ["foundation.co_founder_joined", "👥"],
    ["foundation_deed.signed", "📝"],
    ["coi.escalated", "🚨"],
    ["trustee_license.expiring", "⏰"],
  ])("uses %s's own icon (%s)", (type, icon) => {
    const message = renderWhatsAppMessage({ type, title: "x", body: "y" });
    expect(message.startsWith(`${icon} *x*`)).toBe(true);
  });
});

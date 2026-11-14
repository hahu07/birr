import type { Foundation, Founder, Waqf } from "@birr/db";
import {
  FOUNDATION_DEED_TEMPLATE_VERSION,
  JOINT_FOUNDATION_DEED_TEMPLATE_VERSION,
  foundationDeedTemplateVersion,
  renderFoundationDeedText,
} from "./foundation-deed-template";
// The single-founder (v1) text exactly as rendered before the joint
// variant existed (2026-11-14). It must never change: signed deeds were
// agreed on these words, and FOUNDATION_DEED_TEMPLATE_VERSION still names them.
import v1 from "./__fixtures__/foundation-deed-v1.json";

const foundation = {
  id: "f1",
  name: "Hope for Kids Foundation",
  purpose: "Supporting Islamic education and orphan welfare across Northern Nigeria.",
  jurisdiction: "NG",
} as Foundation;
const founder = { id: "fd1", name: "Amina Bello", kind: "individual", institutionType: null } as Founder;
const waqfs = [{ id: "w1", name: "Scholarship Waqf", type: "investment", jurisdiction: "NG" }] as Waqf[];

describe("renderFoundationDeedText", () => {
  test("a single-founder deed is byte-identical to v1", () => {
    expect(renderFoundationDeedText(foundation, founder, waqfs)).toBe(v1.withFund);
    expect(
      renderFoundationDeedText(
        { ...foundation, jurisdiction: null, purpose: null },
        { ...founder, kind: "institution", institutionType: "islamic_bank" },
        [],
      ),
    ).toBe(v1.institutionNoFunds);
  });

  test("the joint deed signs for every co-founder, present and future, and lists the current ones", () => {
    const text = renderFoundationDeedText(foundation, founder, waqfs, {
      coFounders: [{ name: "Yusuf Bello" }, { name: "Maryam Bello" }],
    });
    expect(text).toContain('This Deed is made by Amina Bello (the "Signing Founder"), an individual,');
    expect(text).toContain("for themselves and on behalf of each co-founder, present and future, of");
    expect(text).toContain('In this Deed, "the Founder" means the Signing Founder and each such');
    expect(text).toContain("7. CO-FOUNDERS");
    expect(text).toContain("  - Yusuf Bello\n  - Maryam Bello");
    expect(text).toContain("IN WITNESS WHEREOF, the Signing Founder has caused this Deed to be signed");
    // The rest of the deed is the same as the single-founder one.
    expect(text).toContain("1. DECLARATION OF WAQF");
    expect(text).toContain("  - Scholarship Waqf — Investment — NG");
  });

  test("a joint deed with no co-founders yet says so", () => {
    const text = renderFoundationDeedText(foundation, founder, waqfs, { coFounders: [] });
    expect(text).toContain("None yet — each co-founder is bound from the day they accept the statement described above.");
  });

  test("each variant carries its own template version", () => {
    expect(foundationDeedTemplateVersion(null)).toBe(FOUNDATION_DEED_TEMPLATE_VERSION);
    expect(foundationDeedTemplateVersion({ coFounders: [] })).toBe(JOINT_FOUNDATION_DEED_TEMPLATE_VERSION);
  });
});

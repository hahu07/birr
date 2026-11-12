"use client";

// Zakah al-Fitr on the public page: one sa' of the season's staple per
// person, paid before Eid. Paid as food (Birr buys and delivers it) under
// every school, or as cash only by those following the Hanafi school
// (owner's decision, 2026-11-11). The server works the amount out again
// from the approved campaign and refuses payments once it has closed.
import { useState } from "react";
import type { ZakahRuleset } from "@birr/zakah";
import { Input } from "@birr/ui";
import { formatDate, formatMoney } from "../../../lib/format";
import { PayZakahForm, type ZakahPaymentTerms } from "./PayZakahForm";

export interface FitrCampaignPublic {
  id: string;
  season: string;
  staple: string;
  kgPerPerson: string;
  amountPerPerson: string;
  opensOn: string;
  closesOn: string;
  expectedEidOn: string;
  state: "upcoming" | "open" | "closed";
}

export function FitrSection({
  campaign,
  rulesets,
  paymentTerms,
}: {
  campaign: FitrCampaignPublic;
  rulesets: ZakahRuleset[];
  paymentTerms: ZakahPaymentTerms | null;
}) {
  const [people, setPeople] = useState("1");
  const [form, setForm] = useState<"food" | "cash">("food");
  const hanafi = rulesets.find((r) => r.madhhab === "hanafi");

  const count = /^\d+$/.test(people) ? Number(people) : 0;
  const validCount = count >= 1 && count <= 100;
  const total = validCount ? (Number(campaign.amountPerPerson) * count).toFixed(2) : null;

  return (
    <section aria-labelledby="fitr-heading" className="mx-auto mt-16 max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">Ramadan {campaign.season}</p>
      <h2 id="fitr-heading" className="font-display mt-2 text-2xl font-medium tracking-tight text-slate-900">
        Zakah al-Fitr
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        One sa&apos; — {campaign.kgPerPerson}kg of {campaign.staple.toLowerCase()} — for each person in your household, given before the Eid
        prayer. This year that&apos;s <strong>{formatMoney(campaign.amountPerPerson, "NGN")} a person</strong>.
      </p>

      {campaign.state === "upcoming" && (
        <p className="mt-4 text-sm text-slate-600">Payments open on {formatDate(campaign.opensOn)}.</p>
      )}
      {campaign.state === "closed" && (
        <p className="mt-4 text-sm text-slate-600">
          Payments through Birr closed on {formatDate(campaign.closesOn)}, so there&apos;s time to deliver before Eid. If you haven&apos;t paid yet,
          please give it directly to someone in need before the Eid prayer.
        </p>
      )}

      {campaign.state === "open" && (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-slate-600">Open until {formatDate(campaign.closesOn)}, the day before Eid, so the food can reach people in time.</p>
          <div>
            <label htmlFor="fitr-people" className="mb-1.5 block text-sm font-medium text-slate-700">
              How many people are you paying for?
            </label>
            <p id="fitr-people-hint" className="mb-1.5 text-xs text-slate-500">Yourself and everyone you support, including children.</p>
            <Input
              id="fitr-people"
              aria-describedby="fitr-people-hint"
              inputMode="numeric"
              className="w-32"
              value={people}
              onChange={(e) => setPeople(e.target.value.replace(/\D/g, ""))}
            />
            {!validCount && <p className="mt-1 text-xs text-red-600">Enter a number from 1 to 100.</p>}
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">Give it as</legend>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="radio" name="fitr-form" className="mt-0.5" checked={form === "food"} onChange={() => setForm("food")} />
              <span>Food — Birr buys {campaign.staple.toLowerCase()} and delivers it to families in need before Eid (valid in every school)</span>
            </label>
            {hanafi && (
              <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
                <input type="radio" name="fitr-form" className="mt-0.5" checked={form === "cash"} onChange={() => setForm("cash")} />
                <span>Cash — passed on as money, for those following the Hanafi school</span>
              </label>
            )}
          </fieldset>

          {total && (
            <p className="text-sm text-slate-700">
              {count} {count === 1 ? "person" : "people"} × {formatMoney(campaign.amountPerPerson, "NGN")} ={" "}
              <span className="font-semibold text-slate-900">{formatMoney(total, "NGN")}</span>
            </p>
          )}

          {total && paymentTerms?.available ? (
            <PayZakahForm
              // Keyed so the form resets when the amount or form changes.
              key={`${total}-${form}`}
              zakahDue={total}
              ruleset={form === "cash" && hanafi ? { key: hanafi.id, version: hanafi.version } : null}
              terms={paymentTerms}
              title="Pay your Zakah al-Fitr through Birr"
              fitr={{ people: count, form }}
            />
          ) : (
            total && <p className="text-sm text-slate-600">Paying through Birr opens soon.</p>
          )}
        </div>
      )}
    </section>
  );
}

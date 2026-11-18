import { ProgrammeSpendKind, WaqfProgrammePot, WaqfProgrammeProduct } from "@birr/db";
import { WAQF_PROGRAMME_PRODUCTS } from "@birr/shared";
import { PRODUCTS, standardDeedText } from "./programme-products";

// The product list in @birr/shared must match what the database allows:
// every product the schema has is defined, and nothing more; and each
// product names only pots and payment kinds that exist.
describe("waqf programme products", () => {
  test("the list names exactly the database's products", () => {
    expect(Object.keys(WAQF_PROGRAMME_PRODUCTS).sort()).toEqual(Object.values(WaqfProgrammeProduct).sort());
  });

  test.each(Object.values(WaqfProgrammeProduct))("%s uses only pots and payment kinds that exist, and has a deed template", (product) => {
    const def = PRODUCTS[product];
    for (const pot of def.pots) expect(Object.values(WaqfProgrammePot)).toContain(pot);
    for (const kind of def.spendKinds) expect(Object.values(ProgrammeSpendKind)).toContain(kind);
    expect(def.publicPath).toMatch(/^\/[a-z-]+$/);
    expect(new Set(def.monthlyMeasures.map((m) => m.key)).size).toBe(def.monthlyMeasures.length);
    expect(Object.keys(def.potLabels).sort()).toEqual([...def.pots].sort());
    expect(standardDeedText({ product, name: "Bodija Clinic", city: "Ibadan" })).toContain("Bodija Clinic");
  });
});

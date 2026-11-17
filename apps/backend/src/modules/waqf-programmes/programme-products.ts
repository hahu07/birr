import { WAQF_PROGRAMME_PRODUCTS, type WaqfProgrammeProductDefinition } from "@birr/shared";
import type { WaqfProgrammeProduct } from "@birr/db";
import { draftClinicDeedText } from "../clinics/clinic-waqf-deed";

// The backend's side of the product list (2026-11-17, shared layer step 3):
// WAQF_PROGRAMME_PRODUCTS in @birr/shared, plus each product's standard deed
// wording. Typed by the database's own WaqfProgrammeProduct, so adding a
// product to the schema fails to compile until it has a definition and a
// deed template here (programme-products.spec.ts checks the reverse).

const DEED_TEMPLATES: Record<WaqfProgrammeProduct, (programme: { name: string; city: string }) => string> = {
  clinic: draftClinicDeedText,
};

export const PRODUCTS: Record<WaqfProgrammeProduct, WaqfProgrammeProductDefinition> = WAQF_PROGRAMME_PRODUCTS;

export function productOf(programme: { product: WaqfProgrammeProduct }): WaqfProgrammeProductDefinition {
  return PRODUCTS[programme.product];
}

/** The product's standard deed wording, filled in for this programme: a draft for Legal and the Shariah Supervisory Board. */
export function standardDeedText(programme: { product: WaqfProgrammeProduct; name: string; city: string }): string {
  return DEED_TEMPLATES[programme.product](programme);
}

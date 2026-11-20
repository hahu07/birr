import { BadRequestException } from "@nestjs/common";
import { WAQF_PROGRAMME_PRODUCTS, type WaqfProgrammeProductDefinition } from "@birr/shared";
import type { ProgrammeSpendKind, WaqfProgrammeProduct } from "@birr/db";
import { draftClinicDeedText } from "../clinics/clinic-waqf-deed";
import { draftKifayahDeedText } from "../kifayah/kifayah-deed";

// The backend's side of the product list (2026-11-17, shared layer step 3):
// WAQF_PROGRAMME_PRODUCTS in @birr/shared, plus each product's standard deed
// wording. Typed by the database's own WaqfProgrammeProduct, so adding a
// product to the schema fails to compile until it has a definition and a
// deed template here (programme-products.spec.ts checks the reverse).
//
// A product's own parts, and payment kinds it doesn't list, are refused on
// any other product (2026-11-18): here, for a plain message, and by the
// database (migration 20261119000500), which programme-products.spec.ts
// checks agrees with this list.

const DEED_TEMPLATES: Record<WaqfProgrammeProduct, (programme: { name: string; city: string }) => string> = {
  clinic: draftClinicDeedText,
  need_based: draftKifayahDeedText,
};

export const PRODUCTS: Record<WaqfProgrammeProduct, WaqfProgrammeProductDefinition> = WAQF_PROGRAMME_PRODUCTS;

export function productOf(programme: { product: WaqfProgrammeProduct }): WaqfProgrammeProductDefinition {
  return PRODUCTS[programme.product];
}

/**
 * How a programme's gifts are named in the AML review lists, beside Vault
 * gifts: "Kifayah (Kifayah waqf)". Typed by the database's
 * products, so a new product needs its own name here.
 */
const REVIEW_NAMES: Record<WaqfProgrammeProduct, string> = {
  clinic: "clinic waqf",
  need_based: "Kifayah waqf",
};

// What a programme is, mid-sentence: "Bodija is a clinic", "Kifayah is a
// Kifayah waqf" (a name, so not lower-cased).
const SENTENCE_NAMES: Record<WaqfProgrammeProduct, string> = {
  clinic: "clinic",
  need_based: "Kifayah waqf",
};

export function reviewName(programme: { name: string; product: WaqfProgrammeProduct }): string {
  return `${programme.name} (${REVIEW_NAMES[programme.product]})`;
}

/** The product's standard deed wording, filled in for this programme: a draft for Legal and the Shariah Supervisory Board. */
export function standardDeedText(programme: { product: WaqfProgrammeProduct; name: string; city: string }): string {
  return DEED_TEMPLATES[programme.product](programme);
}

/**
 * Refuses a product's own part (`what`, e.g. "Price lists") on a programme
 * of another product: "Price lists belong to clinics only; Kifayah is a
 * Kifayah waqf."
 */
export function assertProduct(programme: { product: WaqfProgrammeProduct; name: string }, product: WaqfProgrammeProduct, what: string): void {
  if (programme.product !== product) {
    throw new BadRequestException(
      `${what} belong to ${PRODUCTS[product].plural.toLowerCase()} only; ${programme.name} is a ${SENTENCE_NAMES[programme.product]}.`,
    );
  }
}

/** Whether a programme's product makes endowment payments (and, for works_stage, works projects) of this kind. */
export function allowsSpendKind(programme: { product: WaqfProgrammeProduct }, kind: ProgrammeSpendKind): boolean {
  return (productOf(programme).spendKinds as readonly string[]).includes(kind);
}

/** Refuses an endowment payment kind the programme's product doesn't list. */
export function assertSpendKind(programme: { product: WaqfProgrammeProduct; name: string }, kind: ProgrammeSpendKind, what: string): void {
  if (!allowsSpendKind(programme, kind)) {
    throw new BadRequestException(`${programme.name} is a ${SENTENCE_NAMES[programme.product]}, which has no ${what}.`);
  }
}

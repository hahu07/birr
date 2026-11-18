"use client";

// The public list of Birr's clinic waqfs (/clinics), from the site's menu.
// Shared with every waqf programme product (ProgrammeListPage, need-based NB3).
import { ProgrammeListPage } from "../_components/ProgrammeListPage";

export default function ClinicsIndexPage() {
  return <ProgrammeListPage product="clinic" />;
}

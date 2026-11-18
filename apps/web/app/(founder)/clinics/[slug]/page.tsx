"use client";

// A clinic waqf's public giving page (2026-11-17), with its public report
// (slice 8) below. The page itself is shared by every waqf programme
// product (ProgrammeGivingPage, need-based NB3).
import { useParams } from "next/navigation";
import { ProgrammeGivingPage } from "../../_components/ProgrammeGivingPage";
import { ClinicReport } from "./ClinicReport";

export default function ClinicGivingPage() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <ProgrammeGivingPage product="clinic" slug={slug}>
      <ClinicReport slug={slug} />
    </ProgrammeGivingPage>
  );
}

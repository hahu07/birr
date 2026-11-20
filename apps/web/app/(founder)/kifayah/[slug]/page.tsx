"use client";

// Kifayah's public giving page (built as the need-based waqf's in NB3): giving first.
// The page says support starts once the licensed financing partner and the
// kifayah line are in place, and states no figure about support.
import { useParams } from "next/navigation";
import { ProgrammeGivingPage } from "../../_components/ProgrammeGivingPage";
import { KifayahReport } from "./KifayahReport";

export default function KifayahGivingPage() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <ProgrammeGivingPage product="need_based" slug={slug}>
      <KifayahReport slug={slug} />
    </ProgrammeGivingPage>
  );
}

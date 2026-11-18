"use client";

// A need-based waqf's public giving page (need-based NB3): giving first.
// The page says support starts once the licensed financing partner and the
// kifayah line are in place, and states no figure about support.
import { useParams } from "next/navigation";
import { ProgrammeGivingPage } from "../../_components/ProgrammeGivingPage";

export default function NeedBasedWaqfGivingPage() {
  const { slug } = useParams<{ slug: string }>();
  return <ProgrammeGivingPage product="need_based" slug={slug} />;
}

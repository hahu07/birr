"use client";

// Establish a Foundation — self-service, takes effect immediately. No
// founder picker here (unlike the equivalent Ops Console page this was
// modeled on, which was removed): it's always "you," the signed-in
// founder — the backend enforces this regardless of what's sent
// (FoundationsController.create() forces founderIds to the caller's own
// id whenever x-founder-id is present). This page is for post-onboarding
// use (2nd+ Foundation) — the onboarding wizard's step 2 renders
// FoundationForm directly (see app/onboarding/foundation/page.tsx).
import { useRouter } from "next/navigation";
import { FoundationForm } from "./FoundationForm";
import { PageHeader } from "../../_components/ui";

export default function NewFoundationPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        back={{ href: "/portfolio", label: "Portfolio" }}
        eyebrow="New Foundation"
        title="Establish a Foundation"
        description="This takes effect immediately — Birr becomes Mutawalli (trustee) over it as soon as it's created."
      />

      <FoundationForm onSuccess={() => router.push("/portfolio")} cancelHref="/portfolio" />
    </div>
  );
}

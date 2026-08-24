"use client";

// Establish a Foundation — self-service, takes effect immediately. No
// founder picker here (unlike the equivalent Ops Console page this was
// modeled on, which was removed): it's always "you," the signed-in
// founder — the backend enforces this regardless of what's sent
// (FoundationsController.create() forces founderIds to the caller's own
// id whenever x-founder-id is present). This page is for post-onboarding
// use (2nd+ Foundation) — the onboarding wizard's step 2 renders
// FoundationForm directly (see app/onboarding/foundation/page.tsx).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FoundationForm } from "./FoundationForm";

export default function NewFoundationPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-8">
        <Link href="/portfolio" className="text-sm font-medium text-primary-700 hover:text-primary-800">
          ← Portfolio
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">Establish a Foundation</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          This takes effect immediately — Birr becomes Mutawalli (trustee) over it as soon as it's created.
        </p>
      </header>

      <FoundationForm onSuccess={() => router.push("/portfolio")} cancelHref="/portfolio" />
    </div>
  );
}

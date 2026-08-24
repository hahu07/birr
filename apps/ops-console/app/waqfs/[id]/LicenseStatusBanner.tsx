"use client";

// Flags, never blocks — see TrusteeLicense's own schema comment on the
// backend (packages/db/prisma/schema.prisma) for why establishment
// isn't gated on this. Silent for "active" (the normal case); only
// speaks up when there's something a Birr officer should actually look
// at, with a direct link to go fix it.
import Link from "next/link";
import { Alert } from "@birr/ui";
import type { TrusteeLicenseStatus } from "../../../lib/types";

export function LicenseStatusBanner({
  status,
  jurisdiction,
}: {
  status: TrusteeLicenseStatus | "unlicensed" | undefined;
  jurisdiction: string;
}) {
  if (!status || status === "active") return null;

  const copy: Record<Exclude<TrusteeLicenseStatus | "unlicensed", "active">, string> = {
    unlicensed: `Birr has no recorded trustee license for jurisdiction "${jurisdiction}".`,
    pending: `Birr's trustee license for "${jurisdiction}" is still pending.`,
    suspended: `Birr's trustee license for "${jurisdiction}" is suspended.`,
    expired: `Birr's trustee license for "${jurisdiction}" has expired.`,
  };

  return (
    <Alert tone="warning" title="Trustee licensing status" className="mb-8">
      {copy[status]}{" "}
      <Link href="/jurisdictions" className="font-medium underline hover:no-underline">
        Review in Jurisdictions →
      </Link>
    </Alert>
  );
}

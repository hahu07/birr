// Public landing page — the signed-out counterpart rendered at "/" by
// page.tsx (see app-shell.tsx's HOME_ROUTE handling: this is the one
// route that's public-or-private depending on session, not purely one
// or the other). No Founder Portal chrome — a first-time visitor hasn't
// signed up yet.
import Link from "next/link";
import { Button, IconMark } from "@birr/ui";

export default function MarketingHome() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md text-center">
        <IconMark className="mx-auto h-12 w-12" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">Birr</h1>
        <p className="mt-3 text-base text-slate-600">A digital trustee for Islamic waqf.</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          Establish your own Foundation and Waqf Fund, self-service — Birr becomes Mutawalli (trustee) over what
          you establish, as you agree, no approval gate.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Link href="/sign-up">
            <Button variant="primary" className="w-full">
              Sign up
            </Button>
          </Link>
          <p className="text-sm text-slate-500">
            Already have an account?{" "}
            <Link href="/sign-in" className="font-medium text-primary-700 hover:text-primary-800">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

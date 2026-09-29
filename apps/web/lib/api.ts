// Real session auth — a signed, httpOnly cookie set by the backend
// (POST /founders/sign-up, /founders/login) that rides along on every
// request automatically via credentials: "include". No token/id is ever
// held or read client-side; see apps/backend/src/common/auth/session.ts.
const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

// Both route groups share this one fetch helper — and, since the
// Founder Portal/Ops Console merge, both can carry a valid session
// cookie in the same browser at once (e.g. Birr staff also testing
// their own Founder account). Dual-purpose backend routes
// (WaqfsController.list() and ~20 others — see
// isBirrStaffSession's own comment) used to resolve that ambiguity by
// treating any request with a valid staff cookie as a staff request,
// even one made from a Founder Portal page — which let a Founder
// Portal page silently render another Founder's/the platform's
// unscoped data whenever the calling browser also held a staff
// session (found 2026-09-03, via a founder onboarding page serving an
// unrelated fixture waqf). Path alone reliably says which portal this
// call is actually for, so send it as an explicit header rather than
// leaving the backend to infer intent from cookie presence.
function currentPortal(): "founder" | "ops" {
  if (typeof window === "undefined") return "founder";
  return window.location.pathname.startsWith("/ops") ? "ops" : "founder";
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("x-birr-portal")) {
    headers.set("x-birr-portal", currentPortal());
  }

  return fetch(`${BASE_URL}${path}`, { ...init, credentials: "include", headers });
}

/** A non-2xx response. `code` is the backend's machine-readable reason, when it sent one — branch on that, never on message text. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Throws an ApiError with the backend's own error message on a non-2xx response. */
export async function apiFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message ?? `Request to ${path} failed with status ${res.status}.`;
    throw new ApiError(Array.isArray(message) ? message.join(", ") : message, res.status, typeof body?.code === "string" ? body.code : undefined);
  }
  return body as T;
}

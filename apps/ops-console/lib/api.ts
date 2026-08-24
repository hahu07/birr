// Real cookie-based session auth — the backend sets an httpOnly session
// cookie on POST /birr-staff/login (see
// apps/backend/src/common/auth/session.ts). credentials: "include" is
// required for that cookie to ride along on requests to the backend's
// different origin/port; the backend's CORS config already sets
// credentials: true to allow it.
const BASE_URL = process.env.NEXT_PUBLIC_OPS_BACKEND_URL;

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: "include" });
}

/** Throws with the backend's own error message on a non-2xx response. */
export async function apiFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message ?? `Request to ${path} failed with status ${res.status}.`;
    throw new Error(Array.isArray(message) ? message.join(", ") : message);
  }
  return body as T;
}

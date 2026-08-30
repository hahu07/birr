// Real session auth — a signed, httpOnly cookie set by the backend
// (POST /founders/sign-up, /founders/login) that rides along on every
// request automatically via credentials: "include". No token/id is ever
// held or read client-side; see apps/backend/src/common/auth/session.ts.
const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${BASE_URL}${path}`, { ...init, credentials: "include", headers });
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

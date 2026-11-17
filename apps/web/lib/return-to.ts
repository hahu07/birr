// Where to send someone back to after signing up or in, when they started
// somewhere other than the Founder Portal — a clinic waqf's giving page
// (2026-11-17). Kept in localStorage because sign-up's email link opens a
// new tab, so a query string wouldn't survive. Only ever a path on this
// site, never a full URL. Fails quietly where storage is unavailable.
const KEY = "birr.returnTo";

export function setReturnTo(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) return;
  try {
    localStorage.setItem(KEY, path);
  } catch {
    // Storage blocked: they'll land on the Founder Portal instead.
  }
}

/** Peeks without clearing: to tell whether someone came from a clinic. */
export function peekReturnTo(): string | null {
  try {
    const path = localStorage.getItem(KEY);
    return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}

/** Reads it once, then clears it. */
export function takeReturnTo(): string | null {
  const path = peekReturnTo();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
  return path;
}

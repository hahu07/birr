"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { apiFetch, apiFetchJson } from "./api";
import type { BirrStaff } from "./ops-types";

export type { BirrStaff };

interface StaffSessionValue {
  staff: BirrStaff | null;
  loading: boolean;
  signOut: () => Promise<void>;
  // Whether the signed-in staff member's role holds this permission (GET
  // /birr-staff/me's `permissions`). For showing or hiding controls only —
  // the backend's own guards are the real boundary.
  can: (permissionKey: string) => boolean;
}

const StaffSessionContext = createContext<StaffSessionValue>({
  staff: null,
  loading: true,
  signOut: async () => {},
  can: () => false,
});

// Real session — GET /birr-staff/me resolves identity from the httpOnly
// session cookie set by POST /birr-staff/login. A 401 here just means
// "not signed in," not an error — the sign-in gate below handles it.
export function StaffSessionProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<BirrStaff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<BirrStaff>("/birr-staff/me")
      .then((data) => {
        if (!cancelled) setStaff(data);
      })
      .catch(() => {
        // Not signed in (or session expired) — the sign-in gate handles this.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await apiFetch("/birr-staff/logout", { method: "POST" }).catch(() => {});
    setStaff(null);
  }

  const can = (permissionKey: string) => staff?.permissions?.includes(permissionKey) ?? false;

  return (
    <StaffSessionContext.Provider value={{ staff, loading, signOut, can }}>
      {children}
    </StaffSessionContext.Provider>
  );
}

export function useStaffSession() {
  return useContext(StaffSessionContext);
}

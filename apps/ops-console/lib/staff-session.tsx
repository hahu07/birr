"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { apiFetch, apiFetchJson } from "./api";
import type { BirrStaff } from "./types";

export type { BirrStaff };

interface StaffSessionValue {
  staff: BirrStaff | null;
  loading: boolean;
  signOut: () => void;
}

const StaffSessionContext = createContext<StaffSessionValue>({
  staff: null,
  loading: true,
  signOut: () => {},
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

  function signOut() {
    apiFetch("/birr-staff/logout", { method: "POST" }).finally(() => {
      setStaff(null);
      window.location.href = "/sign-in";
    });
  }

  return (
    <StaffSessionContext.Provider value={{ staff, loading, signOut }}>
      {children}
    </StaffSessionContext.Provider>
  );
}

export function useStaffSession() {
  return useContext(StaffSessionContext);
}

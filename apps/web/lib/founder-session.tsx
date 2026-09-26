"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { apiFetch, apiFetchJson } from "./api";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  mfaEnabled: boolean;
  whatsappVerifiedAt: string | null;
}

export interface Founder {
  id: string;
  name: string;
  kind: "institution" | "individual";
  institutionType: string | null;
  homeJurisdiction: string | null;
  status: string;
}

interface FounderSessionValue {
  user: SessionUser | null;
  founder: Founder | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const FounderSessionContext = createContext<FounderSessionValue>({
  user: null,
  founder: null,
  loading: true,
  signOut: async () => {},
});

/**
 * Real session bootstrap — GET /founders/me relies entirely on the
 * httpOnly session cookie (see lib/api.ts), no client-held id at all.
 * `founder` is legitimately null even mid-session (before onboarding
 * step 2 establishes one), not just pre-session — every consumer of
 * this context needs to handle that, not just the `loading`/no-`user`
 * cases.
 */
export function FounderSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [founder, setFounder] = useState<Founder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<{ user: SessionUser; founder: Founder | null }>("/founders/me")
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setFounder(data.founder);
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setFounder(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await apiFetch("/founders/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setFounder(null);
  }

  return (
    <FounderSessionContext.Provider value={{ user, founder, loading, signOut }}>
      {children}
    </FounderSessionContext.Provider>
  );
}

export function useFounderSession() {
  return useContext(FounderSessionContext);
}

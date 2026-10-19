"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, type Session } from "@/lib/api";
import { Shell } from "@/components/shell";

const Context = createContext<{ session: Session | null; refresh: () => Promise<void> }>({ session: null, refresh: async () => undefined });

export function useSession() {
  return useContext(Context);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const next = await api<Session>("/api/auth/me");
    setSession(next);
    document.title = next.organization ? `${next.organization.name} · ${next.platformName}` : next.platformName;
  }

  useEffect(() => {
    refresh().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load your session."));
  }, []);

  if (error) return <p className="p-8" role="alert">{error}</p>;
  if (!session) return <p className="p-8" role="status">Loading PawHaven…</p>;
  return (
    <Context.Provider value={{ session, refresh }}>
      <Shell session={session} refresh={refresh}>{children}</Shell>
    </Context.Provider>
  );
}

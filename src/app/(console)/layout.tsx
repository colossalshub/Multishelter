"use client";

import { Suspense } from "react";
import { SessionProvider } from "@/components/session";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Suspense fallback={<p className="p-6">Loading…</p>}>{children}</Suspense>
    </SessionProvider>
  );
}

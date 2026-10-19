"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Alert, Button, Field, TextInput } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [platformName, setPlatformName] = useState("PawHaven");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    api<{ platformName: string }>("/api/branding").then((result) => setPlatformName(result.platformName)).catch(() => undefined);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/api/auth/login", { body: { email, password } });
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-card">
        <p className="text-sm font-semibold uppercase tracking-wide text-forest-700">Shelter operations</p>
        <h1 className="mt-1 font-display text-4xl">{platformName}</h1>
        <p className="mt-2 text-sm text-muted">Sign in to manage animals, medical records, and adoptions for your organization.</p>
        <div className="mt-5 space-y-3">
          {error ? <Alert>{error}</Alert> : null}
          <Field label="Email"><TextInput type="email" autoComplete="username" required disabled={!ready || pending} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <Field label="Password"><TextInput type="password" autoComplete="current-password" required disabled={!ready || pending} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Button type="submit" disabled={!ready || pending} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
        </div>
      </form>
    </main>
  );
}

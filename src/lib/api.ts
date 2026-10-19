"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  details?: unknown;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

export function csrfToken(): string {
  const row = document.cookie.split("; ").find((item) => item.startsWith("pawhaven_csrf="));
  return row ? decodeURIComponent(row.slice("pawhaven_csrf=".length)) : "";
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
  const headers = new Headers();
  const csrf = csrfToken();
  if (csrf) headers.set("x-pawhaven-csrf", csrf);
  let body: BodyInit | undefined;
  if (init?.form) body = init.form;
  else if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  const response = await fetch(path, {
    method: init?.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    credentials: "same-origin",
  });
  if (response.status === 401 && !path.startsWith("/api/auth/login") && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string; fields?: Record<string, string>; details?: unknown } };
    throw new ApiError(response.status, data.error?.code ?? "error", data.error?.message ?? "Request failed.", data.error?.fields, data.error?.details);
  }
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/csv")) return (await response.blob()) as T;
  return (await response.json()) as T;
}

export function useQuery<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

export function useDirty(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

export type Session = {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean; mustChangePassword: boolean };
  platformName: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    primaryColor: string;
    accentColor: string;
    timezone: string;
    locale: string;
    dateFormat: string;
    currency: string;
    logoUrl: string | null;
    shelterCount: number;
    adoptionFeeEnabled: boolean;
  } | null;
  role: string | null;
  roleLabel: string | null;
  permissions: string[];
  activeShelterId: string | null;
  shelters: Shelter[];
  needsOnboarding: boolean;
  memberships: { organizationId: string; organizationName: string; role: string }[];
};

export type Shelter = {
  id: string;
  name: string;
  code: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  capacity: number | null;
  notes: string | null;
  active: boolean;
};

export function can(session: Session | null, permission: string): boolean {
  return Boolean(session?.permissions.includes(permission));
}

"use client";

import Link from "next/link";
import { cloneElement, isValidElement, useEffect, useId, useRef } from "react";

const buttonStyles = {
  primary: "bg-forest-700 text-white hover:bg-forest-800",
  secondary: "bg-white text-ink border border-line hover:bg-forest-50",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "bg-transparent text-forest-800 hover:bg-forest-100",
};

export function Button({
  children,
  variant = "primary",
  type = "button",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = buttonStyles[variant];
  return (
    <button type={type} className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: keyof typeof buttonStyles }) {
  return <Link href={href} className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-semibold ${buttonStyles[variant]}`}>{children}</Link>;
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  const id = useId();
  const control = isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children;
  return (
    <div className="block text-sm">
      <label htmlFor={id} className="mb-1 block font-semibold text-ink">{label}</label>
      <div className="[&_input]:w-full [&_select]:w-full [&_textarea]:w-full [&_input]:rounded-lg [&_select]:rounded-lg [&_textarea]:rounded-lg [&_input]:border [&_select]:border [&_textarea]:border [&_input]:border-line [&_select]:border-line [&_textarea]:border-line [&_input]:bg-white [&_select]:bg-white [&_textarea]:bg-white [&_input]:px-3 [&_select]:px-3 [&_textarea]:px-3 [&_input]:py-2 [&_select]:py-2 [&_textarea]:py-2">
        {control}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? <p className="mt-1 text-sm text-danger" role="alert">{error}</p> : null}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} rows={props.rows ?? 4} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

export function Alert({ children, tone = "error" }: { children: React.ReactNode; tone?: "error" | "info" | "success" }) {
  const styles = { error: "border-danger/30 bg-red-50 text-danger", info: "border-forest-700/20 bg-forest-50 text-forest-900", success: "border-forest-700/20 bg-forest-50 text-forest-900" }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  const styles = {
    neutral: "bg-stone-100 text-stone-800",
    good: "bg-forest-100 text-forest-900",
    warn: "bg-amber-100 text-amber-950",
    bad: "bg-red-100 text-red-900",
    info: "bg-sky-100 text-sky-950",
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${styles}`}>{children}</span>;
}

export function statusTone(status: string): "neutral" | "good" | "warn" | "bad" | "info" {
  if (status === "available" || status === "approved" || status === "finalized" || status === "cleared") return "good";
  if (status === "medical_hold" || status === "on_hold" || status === "pending" || status === "adoption_pending") return "warn";
  if (status === "deceased" || status === "rejected" || status === "not_cleared") return "bad";
  if (status === "adopted" || status === "in_foster" || status === "screening") return "info";
  return "neutral";
}

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-card px-6 py-10 text-center">
      <h2 className="font-display text-xl text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-card p-4 shadow-card ${className}`}>{children}</section>;
}

export function Dialog({ open, title, children, onClose }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-card p-5 shadow-card" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="dialog-title" className="font-display text-xl">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted">{total} records</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="px-2 py-2">Page {page} of {pages}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

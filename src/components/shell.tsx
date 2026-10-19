"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, can, type Session } from "@/lib/api";
import { Button } from "@/components/ui";

const LINKS = [
  { href: "/", label: "Dashboard", permission: "" },
  { href: "/animals", label: "Animals", permission: "animals.read" },
  { href: "/medical", label: "Medical", permission: "medical.read" },
  { href: "/tasks", label: "Care tasks", permission: "tasks.read" },
  { href: "/adoptions", label: "Adoptions", permission: "adoptions.read" },
  { href: "/applicants", label: "Applicants", permission: "people.read" },
  { href: "/match", label: "Match", permission: "adoptions.read" },
  { href: "/reports", label: "Reports", permission: "reports.read" },
  { href: "/audit", label: "Audit", permission: "audit.read" },
  { href: "/settings", label: "Settings", permission: "settings.manage" },
];

export function Shell({ session, refresh, children }: { session: Session; refresh: () => Promise<void>; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (session.user.mustChangePassword && pathname !== "/account/password") router.replace("/account/password");
    else if (!session.user.mustChangePassword && session.needsOnboarding && pathname !== "/onboarding") router.replace("/onboarding");
    else if (!session.organization && session.user.isPlatformAdmin && pathname === "/") router.replace("/platform");
  }, [session, pathname, router]);

  useEffect(() => {
    if (!session.organization) return;
    api<{ unread: number }>("/api/notifications").then((result) => setUnread(result.unread)).catch(() => setUnread(0));
  }, [session.organization, pathname]);

  async function chooseOrg(organizationId: string) {
    await api("/api/session/context", { body: { organizationId, shelterId: null } });
    await refresh();
    router.push("/");
  }

  async function chooseShelter(shelterId: string) {
    if (!session.organization) return;
    await api("/api/session/context", { body: { organizationId: session.organization.id, shelterId: shelterId || null } });
    await refresh();
    router.refresh();
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} });
    window.location.href = "/login";
  }

  const links = LINKS.filter((link) => !link.permission || can(session, link.permission) || (link.href === "/settings" && (can(session, "users.manage") || can(session, "shelters.manage"))));
  const accent = session.organization?.primaryColor || "#1f6b4a";

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16rem_1fr]">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className={`${open ? "block" : "hidden"} border-b border-white/10 bg-forest-900 text-white md:block`}>
        <div className="flex items-center gap-3 px-4 py-5">
          {session.organization?.logoUrl ? (
            // Organization logos are private API responses, so they are not passed through the image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.organization.logoUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/10 text-lg" aria-hidden="true">P</span>}
          <div>
            <p className="font-display text-lg leading-tight">{session.platformName}</p>
            <p className="text-xs text-white/70">{session.organization?.name ?? "Platform"}</p>
          </div>
        </div>
        <nav className="px-3 pb-6" aria-label="Primary">
          {session.user.isPlatformAdmin ? <NavLink href="/platform" active={pathname.startsWith("/platform")} onClick={() => setOpen(false)}>Platform</NavLink> : null}
          {session.organization ? links.map((link) => <NavLink key={link.href} href={link.href} active={link.href === "/" ? pathname === "/" : pathname.startsWith(link.href)} onClick={() => setOpen(false)}>{link.label}</NavLink>) : null}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur">
          <Button variant="secondary" className="md:hidden" onClick={() => setOpen((value) => !value)} aria-expanded={open}>Menu</Button>
          {session.memberships.length > 1 ? (
            <label className="text-sm">
              <span className="sr-only">Organization</span>
              <select className="rounded-lg border border-line bg-white px-2 py-2" value={session.organization?.id ?? ""} onChange={(event) => void chooseOrg(event.target.value)}>
                {session.memberships.map((membership) => <option key={membership.organizationId} value={membership.organizationId}>{membership.organizationName}</option>)}
              </select>
            </label>
          ) : null}
          {session.organization ? (
            <label className="text-sm">
              <span className="mr-2 text-muted">{session.shelters.length === 1 ? "Shelter" : "Shelter view"}</span>
              <select className="rounded-lg border border-line bg-white px-2 py-2" value={session.activeShelterId ?? ""} onChange={(event) => void chooseShelter(event.target.value)} aria-label="Shelter">
                <option value="">{session.shelters.length === 1 ? session.shelters[0]?.name : "All authorized shelters"}</option>
                {session.shelters.length > 1 ? session.shelters.map((shelter) => <option key={shelter.id} value={shelter.id}>{shelter.name}</option>) : null}
              </select>
            </label>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {session.organization ? <Link className="rounded-lg px-2 py-2 text-sm font-semibold" href="/notifications">Notifications{unread ? ` (${unread})` : ""}</Link> : null}
            <span className="hidden text-sm text-muted sm:inline">{session.user.name}{session.roleLabel ? ` · ${session.roleLabel}` : ""}</span>
            <Button variant="secondary" onClick={() => void logout()}>Sign out</Button>
          </div>
        </header>
        <main id="content" className="mx-auto max-w-6xl px-4 py-6" style={{ ["--org-accent" as string]: accent }}>
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLink({ href, active, children, onClick }: { href: string; active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <Link href={href} onClick={onClick} aria-current={active ? "page" : undefined} className={`mb-1 block rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-white/15" : "hover:bg-white/10"}`}>{children}</Link>;
}

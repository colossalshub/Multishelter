"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Field, LinkButton, PageHeader, Select, TextArea, TextInput, statusTone } from "@/components/ui";
import { useSession } from "@/components/session";
import { ApiError, api, can, useQuery } from "@/lib/api";

export function Dashboard() {
  const { data, error, loading } = useQuery<{
    inCare: number;
    bySpecies: { cat: number; dog: number };
    available: number;
    medicalHold: number;
    pendingApplications: number;
    byShelter: { id: string; name: string; capacity: number | null; occupancy: number }[];
    recentAdoptions: { id: string; animalId: string; animalName: string; publicCode: string; adoptionDate: string }[];
    upcomingTasks: { id: string; title: string; dueAt: string; animalName: string; publicCode: string }[];
    overdueTasks: { id: string; title: string; dueAt: string; animalName: string; publicCode: string }[];
    recentIntakes: { id: string; name: string; publicCode: string; species: string; shelterName: string; status: string }[];
    recentOutcomes: { id: string; animalId: string; animalName: string; publicCode: string; status: string }[];
  }>("/api/dashboard");
  const { session } = useSession();
  if (!session?.organization) return <Empty title="Choose an organization" body="Platform administrators manage organizations separately from shelter records." action={<LinkButton href="/platform">Open platform</LinkButton>} />;
  if (loading) return <p role="status">Loading dashboard…</p>;
  if (error || !data) return <Alert>{error ?? "Dashboard unavailable."}</Alert>;
  const empty = data.inCare === 0 && data.pendingApplications === 0;
  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`${session.organization.name} · figures come from current records.`} />
      {empty ? <Empty title="No animals in care yet" body="Register an intake to start the census, medical tasks, and adoption queue." action={<LinkButton href="/animals/new">Register animal</LinkButton>} /> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="In care" value={data.inCare} />
        <Stat label="Available" value={data.available} />
        <Stat label="Medical hold" value={data.medicalHold} />
        <Stat label="Open applications" value={data.pendingApplications} />
        <Stat label="Cats in care" value={data.bySpecies.cat} />
        <Stat label="Dogs in care" value={data.bySpecies.dog} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-xl">Shelter occupancy</h2>
          <p className="text-xs text-muted">Occupancy counts animals housed at the shelter. Foster animals are in care but not counted against kennel capacity.</p>
          {data.byShelter.length === 0 ? <p className="mt-2 text-sm">No shelters configured.</p> : data.byShelter.map((shelter) => <p key={shelter.id} className="mt-2 text-sm"><span className="font-semibold">{shelter.name}</span> · {shelter.occupancy}{shelter.capacity != null ? ` / ${shelter.capacity}` : " · capacity not set"}</p>)}
        </Card>
        <Card>
          <h2 className="font-display text-xl">Care reminders</h2>
          {data.overdueTasks.length === 0 && data.upcomingTasks.length === 0 ? <p className="mt-2 text-sm text-muted">No open follow-ups.</p> : null}
          {data.overdueTasks.map((task) => <p key={task.id} className="mt-2 text-sm"><Badge tone="warn">Overdue reminder</Badge> {task.title} · {task.animalName}</p>)}
          {data.upcomingTasks.map((task) => <p key={task.id} className="mt-2 text-sm">{task.title} · {task.animalName} · {new Date(task.dueAt).toLocaleString()}</p>)}
        </Card>
        <Card>
          <h2 className="font-display text-xl">Recent intakes</h2>
          {data.recentIntakes.map((animal) => <p key={animal.id} className="mt-2 text-sm"><Link className="font-semibold text-forest-700" href={`/animals/${animal.id}`}>{animal.publicCode} {animal.name}</Link> · {animal.species} · {animal.shelterName}</p>)}
        </Card>
        <Card>
          <h2 className="font-display text-xl">Recent outcomes and adoptions</h2>
          {data.recentAdoptions.map((adoption) => <p key={adoption.id} className="mt-2 text-sm">{adoption.publicCode} {adoption.animalName} adopted {adoption.adoptionDate}</p>)}
          {data.recentOutcomes.map((outcome) => <p key={outcome.id} className="mt-2 text-sm">{outcome.publicCode} {outcome.animalName} · <Badge tone={statusTone(outcome.status)}>{outcome.status}</Badge></p>)}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <Card><p className="text-sm text-muted">{label}</p><p className="font-display text-3xl">{value}</p></Card>;
}

export function Reports() {
  const catalog = useQuery<{ reports: { type: string; title: string }[] }>("/api/reports");
  const [type, setType] = useState("population");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<{ title: string; columns: string[]; rows: unknown[][] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { session } = useSession();
  async function run() {
    setError(null);
    try {
      setReport(await api(`/api/reports?type=${type}&from=${from}&to=${to}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run the report.");
    }
  }
  async function download() {
    const blob = await api<Blob>("/api/reports/export", { body: { type, from: from || undefined, to: to || undefined } });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${type}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div>
      <PageHeader title="Reports" subtitle="Exports omit applicant contact details unless your role can view them, and spreadsheet formulas are neutralized." />
      {error ? <Alert>{error}</Alert> : null}
      <Card className="grid gap-3 md:grid-cols-4">
        <Field label="Report"><Select value={type} onChange={(event) => setType(event.target.value)}>{catalog.data?.reports.map((item) => <option key={item.type} value={item.type}>{item.title}</option>)}</Select></Field>
        <Field label="From"><TextInput type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
        <Field label="To"><TextInput type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
        <div className="flex items-end gap-2"><Button onClick={() => void run()}>Run</Button>{can(session, "reports.export") ? <Button variant="secondary" onClick={() => void download()}>Export CSV</Button> : null}</div>
      </Card>
      {report ? (
        <div className="mt-4 overflow-auto">
          <h2 className="mb-2 font-display text-xl">{report.title}</h2>
          <table className="responsive w-full text-sm">
            <thead><tr>{report.columns.map((column) => <th key={column} className="p-2 text-left">{column}</th>)}</tr></thead>
            <tbody>{report.rows.map((row, index) => <tr key={index} className="border-t border-line">{row.map((cell, cellIndex) => <td key={cellIndex} className="p-2" data-label={report.columns[cellIndex]}>{String(cell ?? "")}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function AuditLog() {
  const { data, error, loading } = useQuery<{ items: { id: string; action: string; entityType: string; actor: string; createdAt: string }[] }>("/api/audit");
  return (
    <div>
      <PageHeader title="Audit history" subtitle="Sensitive changes are recorded with the acting staff member." />
      {error ? <Alert>{error}</Alert> : null}
      {loading ? <p role="status">Loading audit history…</p> : null}
      <table className="responsive w-full text-sm">
        <thead><tr><th className="p-2 text-left">When</th><th className="p-2 text-left">Action</th><th className="p-2 text-left">Entity</th><th className="p-2 text-left">Actor</th></tr></thead>
        <tbody>{data?.items.map((item) => <tr key={item.id} className="border-t border-line"><td className="p-2" data-label="When">{new Date(item.createdAt).toLocaleString()}</td><td className="p-2" data-label="Action">{item.action}</td><td className="p-2" data-label="Entity">{item.entityType}</td><td className="p-2" data-label="Actor">{item.actor}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function Notifications() {
  const { data, error, reload } = useQuery<{ items: { id: string; title: string; body: string; href: string | null; readAt: string | null }[] }>("/api/notifications");
  return (
    <div>
      <PageHeader title="Notifications" action={<Button variant="secondary" onClick={() => void api("/api/notifications/read-all", { body: {} }).then(() => reload())}>Mark all read</Button>} />
      {error ? <Alert>{error}</Alert> : null}
      <div className="space-y-2">{data?.items.map((item) => <Card key={item.id}><p className="font-semibold">{item.title}</p><p className="text-sm">{item.body}</p>{item.href ? <Link className="text-sm font-semibold text-forest-700" href={item.href}>Open</Link> : null}{!item.readAt ? <Button className="mt-2" variant="ghost" onClick={() => void api(`/api/notifications/${item.id}/read`, { body: {} }).then(() => reload())}>Mark read</Button> : null}</Card>)}</div>
    </div>
  );
}

export function PasswordChange() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/auth/password", { body: { currentPassword, newPassword } });
      window.location.href = "/";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the password.");
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="mx-auto max-w-md space-y-3">
      <PageHeader title="Change password" subtitle="Temporary passwords must be replaced before other records can be opened." />
      {error ? <Alert>{error}</Alert> : null}
      <Field label="Current password"><TextInput type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
      <Field label="New password"><TextInput type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
      <Button type="submit">Update password</Button>
    </form>
  );
}

export function Onboarding() {
  const { session, refresh } = useSession();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(0);
  async function addShelter(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api("/api/shelters", { body: { name, capacity: capacity ? Number(capacity) : null, code: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: city || null, region: null, postalCode: null, country: null, notes: null } });
      setName("");
      setCreated((count) => count + 1);
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the shelter.");
    }
  }
  const count = (session?.organization?.shelterCount ?? 0) + 0;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={`Set up ${session?.organization?.name ?? "your organization"}`} subtitle="One shelter is enough. You can add a second or third now, up to the organization's limit." />
      {error ? <Alert>{error}</Alert> : null}
      <Card>
        <p className="text-sm">Shelters configured: {count}. {created ? "You can add another or continue." : "Add the first shelter to begin intake."}</p>
        <form onSubmit={(event) => void addShelter(event)} className="mt-3 space-y-3">
          <Field label="Shelter name"><TextInput required value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label="City"><TextInput value={city} onChange={(event) => setCity(event.target.value)} /></Field>
          <Field label="Capacity" hint="Optional. Used for occupancy reporting."><TextInput type="number" min={1} value={capacity} onChange={(event) => setCapacity(event.target.value)} /></Field>
          <Button type="submit">Save shelter</Button>
        </form>
      </Card>
      {count > 0 ? <LinkButton href="/">Continue to dashboard</LinkButton> : null}
    </div>
  );
}

export function PlatformHome() {
  const { refresh } = useSession();
  const settings = useQuery<{ platformName: string; maxSheltersPerOrganization: number; supportEmail: string | null }>("/api/platform/settings");
  const orgs = useQuery<{ organizations: { id: string; name: string; slug: string; shelterCount: number; effectiveMaxShelters: number; active: boolean }[] }>("/api/platform/organizations");
  const [form, setForm] = useState({ name: "", adminName: "", adminEmail: "", timezone: "UTC" });
  const [max, setMax] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await api<{ organization: { name: string }; admin: { email: string; temporaryPassword: string | null; existingUser: boolean } }>("/api/platform/organizations", { body: form });
      setResult(created.admin.temporaryPassword ? `${created.organization.name} is ready. Temporary password for ${created.admin.email}: ${created.admin.temporaryPassword}` : `${created.admin.email} already had an account and is now an organization administrator.`);
      setForm({ name: "", adminName: "", adminEmail: "", timezone: "UTC" });
      await orgs.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the organization.");
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Platform" subtitle="Create client organizations and set how many shelters each one may operate. Tenant records stay inside each organization." />
      {error ? <Alert>{error}</Alert> : null}
      {result ? <Alert tone="success">{result}</Alert> : null}
      <Card>
        <h2 className="font-display text-xl">Platform settings</h2>
        <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void api("/api/platform/settings", { method: "PUT", body: { platformName: settings.data?.platformName, maxSheltersPerOrganization: Number(max || settings.data?.maxSheltersPerOrganization), supportEmail: settings.data?.supportEmail ?? null } }).then(() => { void settings.reload(); void refresh(); }); }}>
          <Field label="Maximum shelters per organization"><TextInput type="number" min={1} max={50} value={max || String(settings.data?.maxSheltersPerOrganization ?? 3)} onChange={(event) => setMax(event.target.value)} /></Field>
          <div className="self-end"><Button type="submit">Save limit</Button></div>
        </form>
      </Card>
      <Card>
        <h2 className="font-display text-xl">New organization</h2>
        <form onSubmit={(event) => void create(event)} className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Organization name"><TextInput required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Time zone"><TextInput value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></Field>
          <Field label="Administrator name"><TextInput required value={form.adminName} onChange={(event) => setForm({ ...form, adminName: event.target.value })} /></Field>
          <Field label="Administrator email"><TextInput required type="email" value={form.adminEmail} onChange={(event) => setForm({ ...form, adminEmail: event.target.value })} /></Field>
          <Button type="submit">Create organization</Button>
        </form>
      </Card>
      <Card>
        <h2 className="font-display text-xl">Organizations</h2>
        {orgs.data?.organizations.map((org) => <p key={org.id} className="mt-2 text-sm">{org.name} · {org.shelterCount}/{org.effectiveMaxShelters} shelters · {org.active ? "active" : "inactive"}</p>)}
      </Card>
    </div>
  );
}

export function SettingsPage() {
  const { session, refresh } = useSession();
  const org = useQuery<Record<string, unknown>>(session?.organization ? "/api/organization" : null);
  const shelters = useQuery<{ id: string; name: string; capacity: number | null; active: boolean; city: string | null }[]>("/api/shelters");
  const users = useQuery<{ id: string; name: string; email: string; role: string; active: boolean; shelterIds: string[] }[]>(can(session, "users.manage") ? "/api/users" : null);
  const matrix = useQuery<{ roles: { role: string; label: string; locked: boolean; permissions: string[] }[]; permissions: string[] }>(can(session, "settings.manage") ? "/api/permissions" : null);
  const [shelterName, setShelterName] = useState("");
  const [user, setUser] = useState({ name: "", email: "", role: "animal_care", shelterIds: [] as string[] });
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = org.data as {
    name?: string; timezone?: string; currency?: string; adoptionFeeEnabled?: boolean; defaultAdoptionFeeCents?: number | null; reminderLeadDays?: number;
    primaryColor?: string; accentColor?: string; intakeSources?: string[]; effectiveMaxShelters?: number; shelterCount?: number;
    locale?: string; dateFormat?: string; adoptionAgreement?: string;
  } | null;
  async function saveOrg(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    const form = event.currentTarget as HTMLFormElement;
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    try {
      await api("/api/organization", { method: "PUT", body: {
        ...data,
        name: value("name"),
        email: value("email") || null,
        phone: value("phone") || null,
        city: value("city") || null,
        primaryColor: value("primaryColor"),
        accentColor: value("accentColor"),
        timezone: value("timezone"),
        currency: value("currency"),
        adoptionFeeEnabled: (form.elements.namedItem("adoptionFeeEnabled") as HTMLInputElement).checked,
        defaultAdoptionFeeCents: value("fee") ? Math.round(Number(value("fee")) * 100) : data.defaultAdoptionFeeCents ?? null,
        adoptionAgreement: value("agreement"),
        reminderLeadDays: Number(value("reminder") || data.reminderLeadDays || 2),
      } });
      await refresh();
      await org.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="Branding, shelters, and permissions apply to this organization only." />
      {error ? <Alert>{error}</Alert> : null}
      {password ? <Alert tone="success">Temporary password: {password}</Alert> : null}
      {can(session, "settings.manage") && data ? (
        <Card>
          <h2 className="font-display text-xl">Organization</h2>
          <form onSubmit={(event) => void saveOrg(event)} className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Name"><TextInput name="name" defaultValue={data.name} /></Field>
            <Field label="Time zone"><TextInput name="timezone" defaultValue={data.timezone} /></Field>
            <Field label="Email"><TextInput name="email" type="email" /></Field>
            <Field label="Phone"><TextInput name="phone" /></Field>
            <Field label="City"><TextInput name="city" /></Field>
            <Field label="Currency"><TextInput name="currency" defaultValue={data.currency} /></Field>
            <Field label="Primary color"><TextInput name="primaryColor" defaultValue={data.primaryColor} /></Field>
            <Field label="Accent color"><TextInput name="accentColor" defaultValue={data.accentColor} /></Field>
            <Field label="Reminder lead days"><TextInput name="reminder" type="number" defaultValue={data.reminderLeadDays} /></Field>
            <Field label="Default adoption fee"><TextInput name="fee" type="number" step="0.01" /></Field>
            <label className="flex items-center gap-2 text-sm"><input name="adoptionFeeEnabled" type="checkbox" defaultChecked={data.adoptionFeeEnabled} /> Record adoption fees</label>
            <div className="md:col-span-2"><Field label="Adoption agreement text"><TextArea name="agreement" defaultValue={data.adoptionAgreement} /></Field></div>
            <Button type="submit">Save organization</Button>
          </form>
          <p className="mt-3 text-sm text-muted">Shelter limit: {data.shelterCount} of {data.effectiveMaxShelters}. The server rejects another shelter after the limit.</p>
        </Card>
      ) : null}
      {can(session, "shelters.manage") ? (
        <Card>
          <h2 className="font-display text-xl">Shelters</h2>
          {shelters.data?.map((shelter) => <p key={shelter.id} className="mt-2 text-sm">{shelter.name}{shelter.city ? ` · ${shelter.city}` : ""}{shelter.capacity != null ? ` · capacity ${shelter.capacity}` : ""}</p>)}
          <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void api("/api/shelters", { body: { name: shelterName, capacity: null, code: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, region: null, postalCode: null, country: null, notes: null } }).then(() => { setShelterName(""); void shelters.reload(); void refresh(); }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not add the shelter.")); }}>
            <TextInput aria-label="New shelter name" placeholder="New shelter name" value={shelterName} onChange={(event) => setShelterName(event.target.value)} />
            <Button type="submit">Add shelter</Button>
          </form>
        </Card>
      ) : null}
      {can(session, "users.manage") ? (
        <Card>
          <h2 className="font-display text-xl">Users</h2>
          {users.data?.map((member) => <p key={member.id} className="mt-2 text-sm">{member.name} · {member.email} · {member.role}{member.active ? "" : " · inactive"}</p>)}
          <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void api<{ temporaryPassword: string | null }>("/api/users", { body: { ...user, shelterIds: user.role === "org_admin" ? [] : user.shelterIds } }).then((created) => { setPassword(created.temporaryPassword); void users.reload(); }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not add the user.")); }}>
            <Field label="Name"><TextInput required value={user.name} onChange={(event) => setUser({ ...user, name: event.target.value })} /></Field>
            <Field label="Email"><TextInput required type="email" value={user.email} onChange={(event) => setUser({ ...user, email: event.target.value })} /></Field>
            <Field label="Role"><Select value={user.role} onChange={(event) => setUser({ ...user, role: event.target.value })}><option value="org_admin">Organization administrator</option><option value="shelter_manager">Shelter manager</option><option value="animal_care">Animal care</option><option value="veterinary">Veterinary</option><option value="adoption_staff">Adoption staff</option><option value="read_only">Read-only</option></Select></Field>
            <fieldset className="text-sm"><legend className="mb-1 font-semibold">Shelters</legend>{shelters.data?.map((shelter) => <label key={shelter.id} className="mr-3"><input type="checkbox" checked={user.shelterIds.includes(shelter.id)} onChange={(event) => setUser({ ...user, shelterIds: event.target.checked ? [...user.shelterIds, shelter.id] : user.shelterIds.filter((id) => id !== shelter.id) })} /> {shelter.name}</label>)}</fieldset>
            <Button type="submit">Add user</Button>
          </form>
        </Card>
      ) : null}
      {matrix.data ? (
        <Card>
          <h2 className="font-display text-xl">Permissions</h2>
          <p className="text-sm text-muted">Organization administrators keep full access. Other roles can be adjusted without crossing into another organization.</p>
          <Button className="mt-3" variant="secondary" onClick={() => void api("/api/permissions", { body: { roles: matrix.data?.roles ?? [] } }).then(() => matrix.reload())}>Save current permissions</Button>
        </Card>
      ) : null}
    </div>
  );
}

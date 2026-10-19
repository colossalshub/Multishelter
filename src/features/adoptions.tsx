"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, LinkButton, PageHeader, Select, TextArea, TextInput, statusTone } from "@/components/ui";
import { useSession } from "@/components/session";
import { api, can, useDirty, useQuery } from "@/lib/api";

const TRANSITION_LABELS: Record<string, string> = {
  submitted: "Submit",
  under_review: "Start review",
  screening: "Begin screening",
  approved: "Approve",
  rejected: "Reject",
  on_hold: "Place on hold",
  withdrawn: "Withdraw",
};

type Application = {
  id: string;
  status: string;
  version: number;
  decisionReason: string | null;
  applicant: { id: string; name: string };
  animals: { id: string; name: string; publicCode: string; species: string; status: string }[];
  transitions?: string[];
  screenings?: { id: string; kind: string; occurredAt: string; notes: string | null; result: string | null; actor: string }[];
  adoptions?: { id: string; status: string; adoptionDate: string; animalName: string | null; feeCents: number | null; agreementSummary: string | null; applicantName: string }[];
};

export function ApplicantList() {
  const { data, error, loading } = useQuery<{ id: string; firstName: string; lastName: string; email: string | null; phone: string | null; redactedAt: string | null }[]>("/api/applicants");
  const { session } = useSession();
  return (
    <div>
      <PageHeader title="Applicants" subtitle="Collect only the household details needed for screening." action={can(session, "people.write") ? <LinkButton href="/applicants/new">Add applicant</LinkButton> : null} />
      {error ? <Alert>{error}</Alert> : null}
      {loading ? <p role="status">Loading applicants…</p> : null}
      <div className="space-y-2">
        {data?.map((person) => <Link key={person.id} href={`/applicants/${person.id}`} className="block rounded-xl border border-line bg-card px-4 py-3"><span className="font-semibold">{person.firstName} {person.lastName}</span><span className="ml-2 text-sm text-muted">{person.email || person.phone || ""}</span>{person.redactedAt ? <Badge>Redacted</Badge> : null}</Link>)}
      </div>
    </div>
  );
}

export function ApplicantForm({ applicantId }: { applicantId?: string }) {
  const router = useRouter();
  const existing = useQuery<Record<string, string | number | null>>(applicantId ? `/api/applicants/${applicantId}` : null);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", preferredContact: "email", addressLine1: "", city: "", region: "", postalCode: "", householdAdults: "", householdChildren: "", housingType: "", hasYard: "unknown", otherPets: "", experienceNotes: "" });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDirty(dirty);
  useEffect(() => {
    if (!existing.data || dirty) return;
    const row = existing.data;
    setForm({
      firstName: String(row.firstName ?? ""), lastName: String(row.lastName ?? ""), email: String(row.email ?? ""), phone: String(row.phone ?? ""),
      preferredContact: String(row.preferredContact ?? "email"), addressLine1: String(row.addressLine1 ?? ""), city: String(row.city ?? ""), region: String(row.region ?? ""),
      postalCode: String(row.postalCode ?? ""), householdAdults: row.householdAdults == null ? "" : String(row.householdAdults), householdChildren: row.householdChildren == null ? "" : String(row.householdChildren),
      housingType: String(row.housingType ?? ""), hasYard: String(row.hasYard ?? "unknown"), otherPets: String(row.otherPets ?? ""), experienceNotes: String(row.experienceNotes ?? ""),
    });
  }, [existing.data, dirty]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const payload = { ...form, email: form.email || null, phone: form.phone || null, addressLine1: form.addressLine1 || null, city: form.city || null, region: form.region || null, postalCode: form.postalCode || null, householdAdults: form.householdAdults === "" ? null : Number(form.householdAdults), householdChildren: form.householdChildren === "" ? null : Number(form.householdChildren), housingType: form.housingType || null, otherPets: form.otherPets || null, experienceNotes: form.experienceNotes || null };
      const saved = await api<{ id: string }>(applicantId ? `/api/applicants/${applicantId}` : "/api/applicants", { method: applicantId ? "PATCH" : "POST", body: payload });
      setDirty(false);
      router.push(`/applicants/${saved.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the applicant.");
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <PageHeader title={applicantId ? "Edit applicant" : "Add applicant"} subtitle="Decisions stay with staff. The application is not approved automatically." />
      {error ? <Alert>{error}</Alert> : null}
      <Card className="grid gap-3 md:grid-cols-2">
        {(["firstName", "lastName", "email", "phone", "addressLine1", "city", "region", "postalCode", "housingType"] as const).map((key) => (
          <Field key={key} label={key.replace(/([A-Z])/g, " $1")}><TextInput required={key === "firstName" || key === "lastName"} value={form[key]} onChange={(event) => { setDirty(true); setForm({ ...form, [key]: event.target.value }); }} /></Field>
        ))}
        <Field label="Preferred contact"><Select value={form.preferredContact} onChange={(event) => setForm({ ...form, preferredContact: event.target.value })}><option value="email">Email</option><option value="phone">Phone</option><option value="either">Either</option></Select></Field>
        <Field label="Adults in household"><TextInput type="number" min={0} value={form.householdAdults} onChange={(event) => setForm({ ...form, householdAdults: event.target.value })} /></Field>
        <Field label="Children in household"><TextInput type="number" min={0} value={form.householdChildren} onChange={(event) => setForm({ ...form, householdChildren: event.target.value })} /></Field>
        <Field label="Yard"><Select value={form.hasYard} onChange={(event) => setForm({ ...form, hasYard: event.target.value })}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></Select></Field>
        <div className="md:col-span-2"><Field label="Other pets"><TextArea value={form.otherPets} onChange={(event) => setForm({ ...form, otherPets: event.target.value })} /></Field></div>
        <div className="md:col-span-2"><Field label="Animal-care experience"><TextArea value={form.experienceNotes} onChange={(event) => setForm({ ...form, experienceNotes: event.target.value })} /></Field></div>
      </Card>
      <Button type="submit">Save applicant</Button>
    </form>
  );
}

export function AdoptionList() {
  const params = useSearchParams();
  const status = params.get("status") ?? "";
  const { data, error, loading } = useQuery<Application[]>(`/api/applications${status ? `?status=${status}` : ""}`);
  const { session } = useSession();
  return (
    <div>
      <PageHeader title="Adoptions" subtitle="Draft, review, screen, and finalize applications. Staff make every decision." action={can(session, "adoptions.write") ? <LinkButton href="/adoptions/new">New application</LinkButton> : null} />
      <div className="mb-4 flex flex-wrap gap-2">
        {["", "draft", "submitted", "under_review", "screening", "approved", "finalized", "rejected"].map((value) => <LinkButton key={value || "all"} href={value ? `/adoptions?status=${value}` : "/adoptions"} variant={status === value ? "primary" : "secondary"}>{value || "All"}</LinkButton>)}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {loading ? <p role="status">Loading applications…</p> : null}
      {data && data.length === 0 ? <p className="text-sm text-muted">No applications in this view.</p> : null}
      <div className="space-y-2">
        {data?.map((application) => <Link key={application.id} href={`/adoptions/${application.id}`} className="block rounded-xl border border-line bg-card px-4 py-3"><span className="font-semibold">{application.applicant.name}</span> <Badge tone={statusTone(application.status)}>{application.status.replaceAll("_", " ")}</Badge><p className="text-sm text-muted">{application.animals.map((animal) => `${animal.publicCode} ${animal.name}`).join(", ")}</p></Link>)}
      </div>
    </div>
  );
}

export function AdoptionCreate() {
  const params = useSearchParams();
  const router = useRouter();
  const applicants = useQuery<{ id: string; firstName: string; lastName: string }[]>("/api/applicants");
  const animals = useQuery<{ items: { id: string; name: string; publicCode: string; status: string }[] }>("/api/animals?pageSize=100");
  const [applicantId, setApplicantId] = useState("");
  const [animalIds, setAnimalIds] = useState<string[]>(params.get("animalId") ? [params.get("animalId") as string] : []);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await api<Application>("/api/applications", { body: { applicantId, animalIds } });
      router.push(`/adoptions/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the application.");
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <PageHeader title="New application" subtitle="Choose an applicant and one or more animals. Nothing is approved until a staff member says so." />
      {error ? <Alert>{error}</Alert> : null}
      <Card className="space-y-3">
        <Field label="Applicant"><Select required value={applicantId} onChange={(event) => setApplicantId(event.target.value)}><option value="">Choose</option>{applicants.data?.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</Select></Field>
        <fieldset><legend className="mb-2 text-sm font-semibold">Animals</legend><div className="space-y-1">{animals.data?.items.filter((animal) => !["adopted", "deceased", "transferred", "reunited"].includes(animal.status)).map((animal) => <label key={animal.id} className="flex gap-2 text-sm"><input type="checkbox" checked={animalIds.includes(animal.id)} onChange={(event) => setAnimalIds(event.target.checked ? [...animalIds, animal.id] : animalIds.filter((id) => id !== animal.id))} />{animal.publicCode} · {animal.name}</label>)}</div></fieldset>
        <Button type="submit">Create draft</Button>
      </Card>
    </form>
  );
}

export function AdoptionDetail({ applicationId }: { applicationId: string }) {
  const { session } = useSession();
  const query = useQuery<Application>(`/api/applications/${applicationId}`);
  const org = useQuery<{ adoptionFeeEnabled: boolean; adoptionAgreement: string; shelters: never }>(session?.organization ? "/api/organization" : null);
  const [reason, setReason] = useState("");
  const [screening, setScreening] = useState({ kind: "interview", notes: "" });
  const [fee, setFee] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const application = query.data;
  async function transition(status: string) {
    if (!application) return;
    setError(null);
    const submittedReason = reason;
    try {
      await api(`/api/applications/${application.id}/transition`, { body: { status, reason: submittedReason || null, version: application.version } });
      setReason((current) => (current === submittedReason ? "" : current));
      await query.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the application.");
    }
  }
  async function finalize() {
    if (!application) return;
    try {
      await api(`/api/applications/${application.id}/finalize`, { body: { adoptionDate: new Date().toISOString().slice(0, 10), agreementSummary: org.data?.adoptionAgreement || null, animals: application.animals.map((animal) => ({ animalId: animal.id, feeCents: fee === "" ? null : Math.round(Number(fee) * 100) })), acknowledgeClearanceUnknown: ack, version: application.version } });
      await query.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not finalize the adoption.");
    }
  }
  if (query.loading) return <p role="status">Loading application…</p>;
  if (!application) return <Alert>{query.error ?? "Application not found."}</Alert>;
  return (
    <div className="space-y-4">
      <PageHeader title={application.applicant.name} subtitle="Adoption application" action={<Badge tone={statusTone(application.status)}>{application.status.replaceAll("_", " ")}</Badge>} />
      {error ? <Alert>{error}</Alert> : null}
      <Card>
        <h2 className="font-display text-xl">Animals</h2>
        <ul className="mt-2 space-y-1 text-sm">{application.animals.map((animal) => <li key={animal.id}><Link className="font-semibold text-forest-700" href={`/animals/${animal.id}`}>{animal.publicCode} · {animal.name}</Link> · {animal.status.replaceAll("_", " ")}</li>)}</ul>
        {application.decisionReason ? <p className="mt-3 text-sm">Decision note: {application.decisionReason}</p> : null}
      </Card>
      {can(session, "adoptions.write") && application.transitions?.length ? (
        <Card>
          <h2 className="font-display text-xl">Workflow</h2>
          <Field label="Reason or note"><TextArea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <div className="mt-3 flex flex-wrap gap-2">{application.transitions.map((status) => <Button key={status} variant={status === "rejected" || status === "withdrawn" ? "danger" : "primary"} onClick={() => void transition(status)}>{TRANSITION_LABELS[status] ?? status}</Button>)}</div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Field label="Screening kind"><Select value={screening.kind} onChange={(event) => setScreening({ ...screening, kind: event.target.value })}><option value="interview">Interview</option><option value="reference">Reference check</option><option value="communication">Communication</option><option value="note">Note</option></Select></Field>
            <Field label="Screening notes"><TextInput value={screening.notes} onChange={(event) => setScreening({ ...screening, notes: event.target.value })} /></Field>
            <div className="self-end"><Button variant="secondary" onClick={() => void api(`/api/applications/${application.id}/screening`, { body: { kind: screening.kind, occurredAt: new Date().toISOString(), notes: screening.notes || null, result: null } }).then(() => query.reload())}>Add screening</Button></div>
          </div>
        </Card>
      ) : null}
      {application.status === "approved" && can(session, "adoptions.finalize") ? (
        <Card>
          <h2 className="font-display text-xl">Finalize adoption</h2>
          <p className="text-sm text-muted">Finalizing updates the animal and the adoption record together. Unknown medical clearance is not treated as healthy.</p>
          {org.data?.adoptionFeeEnabled ? <Field label="Fee per animal"><TextInput type="number" min={0} step="0.01" value={fee} onChange={(event) => setFee(event.target.value)} /></Field> : <p className="mt-2 text-sm text-muted">Adoption fees are turned off for this organization.</p>}
          <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> I acknowledge that any animal with unknown medical clearance is not being declared healthy.</label>
          <Button className="mt-3" onClick={() => void finalize()}>Finalize adoption</Button>
        </Card>
      ) : null}
      {application.screenings?.length ? <Card><h2 className="font-display text-xl">Screening</h2>{application.screenings.map((item) => <p key={item.id} className="mt-2 text-sm">{item.kind} · {new Date(item.occurredAt).toLocaleString()} · {item.actor}<br />{item.notes}</p>)}</Card> : null}
      {application.adoptions?.map((adoption) => (
        <Card key={adoption.id}>
          <h2 className="font-display text-xl">{adoption.status === "returned" ? "Returned adoption" : "Completed adoption"}</h2>
          <p className="text-sm">{adoption.animalName} · {adoption.adoptionDate} · {adoption.applicantName}</p>
          {adoption.agreementSummary ? <p className="mt-2 text-sm">{adoption.agreementSummary}</p> : null}
          {adoption.status === "active" && can(session, "adoptions.finalize") ? <ReturnForm adoptionId={adoption.id} onDone={() => query.reload()} /> : null}
          {adoption.status === "active" && can(session, "adoptions.write") ? <FollowUpForm adoptionId={adoption.id} /> : null}
        </Card>
      ))}
    </div>
  );
}

function ReturnForm({ adoptionId, onDone }: { adoptionId: string; onDone: () => void }) {
  const { session } = useSession();
  const [reason, setReason] = useState("");
  const [shelterId, setShelterId] = useState(session?.shelters[0]?.id ?? "");
  return (
    <div className="mt-3 space-y-2">
      <Field label="Return reason"><TextInput value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      <Field label="Return to shelter"><Select value={shelterId} onChange={(event) => setShelterId(event.target.value)}>{session?.shelters.map((shelter) => <option key={shelter.id} value={shelter.id}>{shelter.name}</option>)}</Select></Field>
      <Button variant="secondary" onClick={() => void api(`/api/adoptions/${adoptionId}/return`, { body: { reason, shelterId, status: "intake_pending" } }).then(onDone)}>Record return to shelter</Button>
    </div>
  );
}

function FollowUpForm({ adoptionId }: { adoptionId: string }) {
  const [date, setDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="mt-3">
      <Field label="Post-adoption follow-up"><TextInput type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      <Button className="mt-2" variant="secondary" onClick={() => void api(`/api/adoptions/${adoptionId}/follow-ups`, { body: { scheduledAt: new Date(date).toISOString(), notes: null } }).then(() => setMessage("Follow-up scheduled."))}>Schedule follow-up</Button>
      {message ? <p className="mt-2 text-sm">{message}</p> : null}
    </div>
  );
}

export function MatchPage() {
  const [species, setSpecies] = useState("");
  const [size, setSize] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useQuery<{ notice: string; items: { id: string; name: string; publicCode: string; species: string; statusLabel: string; temperament: string | null; shelter: { name: string } }[] }>(`/api/match?species=${species}&size=${size}&temperament=${encodeURIComponent(query)}`);
  return (
    <div>
      <PageHeader title="Adoption matching" subtitle="Filters help staff shortlist animals. They are not a compatibility guarantee." />
      <Card className="mb-4 grid gap-3 md:grid-cols-3">
        <Field label="Species"><Select value={species} onChange={(event) => setSpecies(event.target.value)}><option value="">Any</option><option value="cat">Cat</option><option value="dog">Dog</option></Select></Field>
        <Field label="Size"><Select value={size} onChange={(event) => setSize(event.target.value)}><option value="">Any</option>{["small", "medium", "large", "xlarge"].map((item) => <option key={item}>{item}</option>)}</Select></Field>
        <Field label="Temperament contains"><TextInput value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
        <Button onClick={() => void reload()}>Update matches</Button>
      </Card>
      {error ? <Alert>{error}</Alert> : null}
      {loading ? <p role="status">Looking up animals…</p> : null}
      {data ? <Alert tone="info">{data.notice}</Alert> : null}
      <div className="mt-3 space-y-2">{data?.items.map((animal) => <Link key={animal.id} href={`/animals/${animal.id}`} className="block rounded-xl border border-line bg-card px-4 py-3"><span className="font-semibold">{animal.publicCode} · {animal.name}</span><p className="text-sm text-muted">{animal.species} · {animal.shelter.name} · {animal.temperament || "No temperament notes"}</p></Link>)}</div>
    </div>
  );
}

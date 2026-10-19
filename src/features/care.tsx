"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { Alert, Badge, Button, Card, Field, LinkButton, PageHeader, Select, TextArea, TextInput } from "@/components/ui";
import { useSession } from "@/components/session";
import { ApiError, api, can, useDirty, useQuery } from "@/lib/api";

type RecordItem = {
  id: string;
  animalId: string;
  animalName: string | null;
  animalCode: string | null;
  category: string;
  occurredAt: string;
  providerName: string | null;
  providerIsVeterinarian: boolean;
  observations: string | null;
  diagnosis: string | null;
  treatment: string | null;
  medicationName: string | null;
  dose: string | null;
  instructions: string | null;
  nextFollowUpAt: string | null;
  allergies: string | null;
  notes: string | null;
  supersededAt: string | null;
  enteredBy: string | null;
  disclaimer: string;
  attachments?: { id: string; fileName: string; url: string }[];
  administrations?: { id: string; administeredAt: string; notes: string | null; administeredBy: string }[];
};

export function MedicalList() {
  const params = useSearchParams();
  const { session } = useSession();
  const query = params.toString();
  const { data, error, loading } = useQuery<{ items: RecordItem[] }>(`/api/medical-records?${query}`);
  return (
    <div>
      <PageHeader title="Medical records" subtitle="Staff record information supplied by people caring for the animal. PawHaven does not generate diagnoses or doses." action={can(session, "medical.write") ? <LinkButton href="/medical/new">Add record</LinkButton> : null} />
      {error ? <Alert>{error}</Alert> : null}
      {loading ? <p role="status">Loading records…</p> : null}
      {data && data.items.length === 0 ? <p className="text-sm text-muted">No medical records match these filters.</p> : null}
      <div className="space-y-3">
        {data?.items.map((record) => (
          <Link key={record.id} href={`/medical/${record.id}`} className="block">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{record.animalName} · {record.animalCode}</p>
                <Badge tone={record.supersededAt ? "neutral" : "info"}>{record.supersededAt ? "Corrected" : record.category.replaceAll("_", " ")}</Badge>
              </div>
              <p className="text-sm text-muted">{new Date(record.occurredAt).toLocaleString()}{record.providerName ? ` · ${record.providerName}` : ""}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function MedicalForm({ animalId, correcting }: { animalId?: string; correcting?: string }) {
  const router = useRouter();
  const { session } = useSession();
  const org = useQuery<{ medicalCatalog: { key: string; label: string }[] }>(session?.organization ? "/api/organization" : null);
  const animals = useQuery<{ items: { id: string; name: string; publicCode: string }[] }>("/api/animals?pageSize=100");
  const [form, setForm] = useState({
    animalId: animalId ?? "",
    category: "veterinary_consultation",
    occurredAt: new Date().toISOString().slice(0, 16),
    providerName: "",
    providerIsVeterinarian: false,
    observations: "",
    diagnosis: "",
    treatment: "",
    medicationName: "",
    dose: "",
    instructions: "",
    nextFollowUpAt: "",
    allergies: "",
    notes: "",
    updateSterilizationStatus: "",
  });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  useDirty(dirty);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const payload = {
        ...form,
        occurredAt: new Date(form.occurredAt).toISOString(),
        providerName: form.providerName || null,
        observations: form.observations || null,
        diagnosis: form.diagnosis || null,
        treatment: form.treatment || null,
        medicationName: form.medicationName || null,
        dose: form.dose || null,
        instructions: form.instructions || null,
        nextFollowUpAt: form.nextFollowUpAt ? new Date(form.nextFollowUpAt).toISOString() : null,
        allergies: form.allergies || null,
        notes: form.notes || null,
        updateSterilizationStatus: form.updateSterilizationStatus || null,
      };
      const record = await api<RecordItem>(correcting ? `/api/medical-records/${correcting}/corrections` : "/api/medical-records", { body: payload });
      setDirty(false);
      router.push(`/medical/${record.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(500, "error", "Could not save the record."));
    }
  }
  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <PageHeader title={correcting ? "Correct medical record" : "Add medical record"} subtitle="Record what a qualified person observed or prescribed. Do not invent a diagnosis or dose." />
      <Alert tone="info">Shelter staff are entering a record. A diagnosis can be saved only when a veterinary professional is named as the source.</Alert>
      {error ? <Alert>{error.message}</Alert> : null}
      <Card className="grid gap-3 md:grid-cols-2">
        <Field label="Animal" error={error?.fields?.animalId}><Select required value={form.animalId} onChange={(event) => set("animalId", event.target.value)}><option value="">Choose</option>{animals.data?.items.map((animal) => <option key={animal.id} value={animal.id}>{animal.publicCode} · {animal.name}</option>)}</Select></Field>
        <Field label="Category"><Select value={form.category} onChange={(event) => set("category", event.target.value)}>{(org.data?.medicalCatalog ?? []).map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}</Select></Field>
        <Field label="Date"><TextInput required type="datetime-local" value={form.occurredAt} onChange={(event) => set("occurredAt", event.target.value)} /></Field>
        <Field label="Provider name" error={error?.fields?.providerName}><TextInput value={form.providerName} onChange={(event) => set("providerName", event.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={form.providerIsVeterinarian} onChange={(event) => set("providerIsVeterinarian", event.target.checked)} /> This information was provided by a veterinary professional</label>
        <div className="md:col-span-2"><Field label="Observations"><TextArea value={form.observations} onChange={(event) => set("observations", event.target.value)} /></Field></div>
        <div className="md:col-span-2"><Field label="Diagnosis as recorded" error={error?.fields?.diagnosis} hint="Leave blank unless a veterinarian provided it."><TextArea value={form.diagnosis} onChange={(event) => set("diagnosis", event.target.value)} /></Field></div>
        <div className="md:col-span-2"><Field label="Treatment as recorded"><TextArea value={form.treatment} onChange={(event) => set("treatment", event.target.value)} /></Field></div>
        <Field label="Medication"><TextInput value={form.medicationName} onChange={(event) => set("medicationName", event.target.value)} /></Field>
        <Field label="Dose as recorded"><TextInput value={form.dose} onChange={(event) => set("dose", event.target.value)} /></Field>
        <div className="md:col-span-2"><Field label="Instructions as recorded"><TextArea value={form.instructions} onChange={(event) => set("instructions", event.target.value)} /></Field></div>
        <Field label="Allergies or reactions"><TextInput value={form.allergies} onChange={(event) => set("allergies", event.target.value)} /></Field>
        <Field label="Next follow-up"><TextInput type="datetime-local" value={form.nextFollowUpAt} onChange={(event) => set("nextFollowUpAt", event.target.value)} /></Field>
        <Field label="Also update sterilization status"><Select value={form.updateSterilizationStatus} onChange={(event) => set("updateSterilizationStatus", event.target.value)}><option value="">Do not change</option><option value="sterilized">Sterilized</option><option value="intact">Intact</option><option value="unknown">Unknown</option></Select></Field>
        <div className="md:col-span-2"><Field label="Notes"><TextArea value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Field></div>
      </Card>
      <Button type="submit">Save record</Button>
    </form>
  );
}

export function MedicalDetail({ recordId }: { recordId: string }) {
  const { session } = useSession();
  const query = useQuery<RecordItem>(`/api/medical-records/${recordId}`);
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const record = query.data;
  if (query.loading) return <p role="status">Loading record…</p>;
  if (!record) return <Alert>{query.error ?? "Record not found."}</Alert>;
  return (
    <div className="space-y-4">
      <PageHeader title={record.category.replaceAll("_", " ")} subtitle={`${record.animalName} · ${record.animalCode}`} action={can(session, "medical.write") && !record.supersededAt ? <LinkButton href={`/medical/new?animalId=${record.animalId}&correct=${record.id}`} variant="secondary">Correct this record</LinkButton> : null} />
      <Alert tone="info">{record.disclaimer}</Alert>
      {record.supersededAt ? <Alert>This entry was corrected and is kept for history.</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      <Card className="grid gap-2 text-sm sm:grid-cols-2">
        <p><span className="text-muted">When</span><br />{new Date(record.occurredAt).toLocaleString()}</p>
        <p><span className="text-muted">Entered by</span><br />{record.enteredBy}</p>
        <p><span className="text-muted">Provider</span><br />{record.providerName || "—"} {record.providerIsVeterinarian ? "(veterinary professional)" : "(not recorded as a veterinarian)"}</p>
        <p><span className="text-muted">Medication</span><br />{record.medicationName || "—"}</p>
        <p className="sm:col-span-2"><span className="text-muted">Observations</span><br />{record.observations || "—"}</p>
        <p className="sm:col-span-2"><span className="text-muted">Diagnosis as recorded</span><br />{record.diagnosis || "—"}</p>
        <p className="sm:col-span-2"><span className="text-muted">Dose and instructions</span><br />{[record.dose, record.instructions].filter(Boolean).join(" · ") || "—"}</p>
        <p className="sm:col-span-2"><span className="text-muted">Allergies</span><br />{record.allergies || "—"}</p>
      </Card>
      {can(session, "medical.write") && !record.supersededAt ? (
        <Card>
          <h2 className="font-display text-xl">Record an administration</h2>
          <p className="text-sm text-muted">Medication is marked given only when someone records it.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Time"><TextInput type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} /></Field>
            <Field label="Notes"><TextInput value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          </div>
          <Button className="mt-3" onClick={() => api(`/api/medical-records/${record.id}/administrations`, { body: { administeredAt: new Date(when).toISOString(), notes: notes || null } }).then(() => query.reload()).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not record administration."))}>Record administration</Button>
          <label className="mt-4 block text-sm font-semibold">Supporting document<input className="mt-1 block text-sm" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const form = new FormData(); form.set("file", file); void api(`/api/medical-records/${record.id}/attachments`, { form }).then(() => query.reload()); }} /></label>
        </Card>
      ) : null}
      <Card>
        <h2 className="font-display text-xl">Administrations</h2>
        {record.administrations?.length ? record.administrations.map((item) => <p key={item.id} className="mt-2 text-sm">{new Date(item.administeredAt).toLocaleString()} · {item.administeredBy}{item.notes ? ` · ${item.notes}` : ""}</p>) : <p className="mt-2 text-sm text-muted">None recorded.</p>}
        {record.attachments?.map((file) => <p key={file.id} className="mt-2 text-sm"><a className="font-semibold text-forest-700" href={file.url}>{file.fileName}</a></p>)}
      </Card>
    </div>
  );
}

export function TaskList() {
  const params = useSearchParams();
  const due = params.get("due") ?? "open";
  const { data, error, loading, reload } = useQuery<{ id: string; title: string; dueAt: string; status: string; overdue: boolean; reminder: string | null; animalName: string | null; animalCode: string | null }[]>(`/api/care-tasks?due=${due}`);
  const { session } = useSession();
  return (
    <div>
      <PageHeader title="Care tasks" subtitle="Overdue means the reminder date has passed. It is not an emergency diagnosis." />
      <div className="mb-4 flex gap-2">
        {["open", "overdue", "upcoming"].map((value) => <LinkButton key={value} href={`/tasks?due=${value}`} variant={due === value ? "primary" : "secondary"}>{value}</LinkButton>)}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {loading ? <p role="status">Loading tasks…</p> : null}
      {data && data.length === 0 ? <p className="text-sm text-muted">No tasks in this view.</p> : null}
      <div className="space-y-3">
        {data?.map((task) => (
          <Card key={task.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{task.title}</p>
                <p className="text-sm text-muted">{task.animalName} · {task.animalCode} · {new Date(task.dueAt).toLocaleString()}</p>
                {task.reminder ? <p className="text-sm">{task.reminder}</p> : null}
              </div>
              {task.overdue ? <Badge tone="warn">Overdue reminder</Badge> : <Badge>{task.status}</Badge>}
            </div>
            {can(session, "tasks.write") && task.status === "open" ? (
              <div className="mt-3 flex gap-2">
                <Button onClick={() => void api(`/api/care-tasks/${task.id}/complete`, { body: {} }).then(() => reload())}>Mark complete</Button>
                <Button variant="secondary" onClick={() => void api(`/api/care-tasks/${task.id}/cancel`, { body: {} }).then(() => reload())}>Cancel</Button>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}

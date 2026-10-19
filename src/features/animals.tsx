"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Dialog, Empty, Field, LinkButton, PageHeader, Pagination, Select, TextArea, TextInput, statusTone } from "@/components/ui";
import { useSession } from "@/components/session";
import { ApiError, api, can, useDirty, useQuery } from "@/lib/api";

type Animal = {
  id: string;
  publicCode: string;
  name: string;
  species: string;
  breed: string | null;
  breedUnknown: boolean;
  sex: string;
  birthDate: string | null;
  birthDateEstimated: boolean;
  estimatedAgeYears: number | null;
  estimatedAgeMonths: number | null;
  ageLabel: string | null;
  color: string | null;
  distinguishingFeatures: string | null;
  microchip: string | null;
  intakeDate: string;
  intakeSource: string;
  previousOwner: { name: string | null; phone: string | null; email: string | null; notes: string | null } | null;
  housingLocation: string | null;
  status: string;
  statusLabel: string;
  temperament: string | null;
  specialHandling: string | null;
  dietaryNeeds: string | null;
  sterilizationStatus: string;
  identificationTags: string | null;
  notes: string | null;
  size: string;
  activityLevel: string;
  weightGrams: number | null;
  medicalClearance: string;
  medicalClearanceBasis: string | null;
  version: number;
  archivedAt: string | null;
  shelter: { id: string; name: string };
  photos: { id: string; isPrimary: boolean; url: string }[];
};

type OrgConfig = {
  intakeSources: string[];
  catalog: { key: string; label: string; category: string }[];
  effectiveMaxShelters: number;
};

const blank = {
  name: "", species: "cat", breed: "", breedUnknown: true, sex: "unknown", birthDate: "", birthDateEstimated: true,
  estimatedAgeYears: "", estimatedAgeMonths: "", color: "", distinguishingFeatures: "", microchip: "", intakeDate: "",
  intakeSource: "stray", previousOwnerName: "", previousOwnerPhone: "", previousOwnerEmail: "", previousOwnerNotes: "",
  housingLocation: "", temperament: "", specialHandling: "", dietaryNeeds: "", sterilizationStatus: "unknown",
  identificationTags: "", notes: "", size: "unknown", activityLevel: "unknown", weightKg: "", shelterId: "",
};

export function AnimalList() {
  const params = useSearchParams();
  const router = useRouter();
  const { session } = useSession();
  const query = params.toString();
  const { data, error, loading } = useQuery<{ items: Animal[]; page: number; pageSize: number; total: number }>(`/api/animals?${query}`);
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    router.push(`/animals?${next.toString()}`);
  }
  return (
    <div>
      <PageHeader title="Animals" subtitle="Search cats and dogs across the shelters you can access." action={can(session, "animals.write") ? <LinkButton href="/animals/new">Register animal</LinkButton> : null} />
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Search"><TextInput value={params.get("q") ?? ""} placeholder="Name, ID, or microchip" onChange={(event) => setParam("q", event.target.value)} /></Field>
          <Field label="Species"><Select value={params.get("species") ?? ""} onChange={(event) => setParam("species", event.target.value)}><option value="">Any</option><option value="cat">Cat</option><option value="dog">Dog</option></Select></Field>
          <Field label="Status"><TextInput value={params.get("status") ?? ""} placeholder="available" onChange={(event) => setParam("status", event.target.value)} /></Field>
          <Field label="Shelter"><Select value={params.get("shelterId") ?? ""} onChange={(event) => setParam("shelterId", event.target.value)}><option value="">Current view</option>{session?.shelters.map((shelter) => <option key={shelter.id} value={shelter.id}>{shelter.name}</option>)}</Select></Field>
        </div>
      </Card>
      {error ? <Alert>{error}</Alert> : null}
      {loading ? <p role="status">Loading animals…</p> : null}
      {data && data.items.length === 0 ? <Empty title="No animals yet" body="Register an intake when an animal arrives. Unknown details can be left blank." action={can(session, "animals.write") ? <LinkButton href="/animals/new">Register animal</LinkButton> : null} /> : null}
      {data && data.items.length > 0 ? (
        <table className="responsive w-full text-sm">
          <thead className="text-left text-muted"><tr><th className="p-2">ID</th><th className="p-2">Name</th><th className="p-2">Species</th><th className="p-2">Status</th><th className="p-2">Shelter</th></tr></thead>
          <tbody>
            {data.items.map((animal) => (
              <tr key={animal.id} className="border-t border-line">
                <td className="p-2" data-label="ID"><Link className="font-semibold text-forest-700" href={`/animals/${animal.id}`}>{animal.publicCode}</Link></td>
                <td className="p-2" data-label="Name"><Link className="font-semibold text-forest-700" href={`/animals/${animal.id}`}>{animal.name}</Link></td>
                <td className="p-2 capitalize" data-label="Species">{animal.species}</td>
                <td className="p-2" data-label="Status"><Badge tone={statusTone(animal.status)}>{animal.statusLabel}</Badge></td>
                <td className="p-2" data-label="Shelter">{animal.shelter.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {data ? <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setParam("page", String(page))} /> : null}
    </div>
  );
}

export function AnimalForm({ animalId }: { animalId?: string }) {
  const router = useRouter();
  const { session } = useSession();
  const org = useQuery<OrgConfig>(session?.organization ? "/api/organization" : null);
  const existing = useQuery<Animal>(animalId ? `/api/animals/${animalId}` : null);
  const [form, setForm] = useState(blank);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  useDirty(dirty);
  useEffect(() => {
    if (!existing.data) return;
    const animal = existing.data;
    setForm({
      ...blank,
      name: animal.name,
      species: animal.species,
      breed: animal.breed ?? "",
      breedUnknown: animal.breedUnknown,
      sex: animal.sex,
      birthDate: animal.birthDate ?? "",
      birthDateEstimated: animal.birthDateEstimated,
      estimatedAgeYears: animal.estimatedAgeYears?.toString() ?? "",
      estimatedAgeMonths: animal.estimatedAgeMonths?.toString() ?? "",
      color: animal.color ?? "",
      distinguishingFeatures: animal.distinguishingFeatures ?? "",
      microchip: animal.microchip ?? "",
      intakeDate: animal.intakeDate.slice(0, 16),
      intakeSource: animal.intakeSource,
      previousOwnerName: animal.previousOwner?.name ?? "",
      previousOwnerPhone: animal.previousOwner?.phone ?? "",
      previousOwnerEmail: animal.previousOwner?.email ?? "",
      previousOwnerNotes: animal.previousOwner?.notes ?? "",
      housingLocation: animal.housingLocation ?? "",
      temperament: animal.temperament ?? "",
      specialHandling: animal.specialHandling ?? "",
      dietaryNeeds: animal.dietaryNeeds ?? "",
      sterilizationStatus: animal.sterilizationStatus,
      identificationTags: animal.identificationTags ?? "",
      notes: animal.notes ?? "",
      size: animal.size,
      activityLevel: animal.activityLevel,
      weightKg: animal.weightGrams != null ? String(animal.weightGrams / 1000) : "",
      shelterId: animal.shelter.id,
    });
  }, [existing.data]);
  useEffect(() => {
    if (!animalId && session?.shelters[0] && !form.shelterId) setForm((current) => ({ ...current, shelterId: session.activeShelterId || session.shelters[0]?.id || "", intakeDate: new Date().toISOString().slice(0, 16) }));
  }, [animalId, session, form.shelterId]);

  function update(key: string, value: string | boolean) {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent, acknowledgeDuplicates = false) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const payload = {
      ...form,
      breed: form.breed || null,
      birthDate: form.birthDate || null,
      estimatedAgeYears: form.estimatedAgeYears === "" ? null : Number(form.estimatedAgeYears),
      estimatedAgeMonths: form.estimatedAgeMonths === "" ? null : Number(form.estimatedAgeMonths),
      color: form.color || null,
      distinguishingFeatures: form.distinguishingFeatures || null,
      microchip: form.microchip || null,
      intakeDate: new Date(form.intakeDate).toISOString(),
      previousOwnerName: form.previousOwnerName || null,
      previousOwnerPhone: form.previousOwnerPhone || null,
      previousOwnerEmail: form.previousOwnerEmail || null,
      previousOwnerNotes: form.previousOwnerNotes || null,
      housingLocation: form.housingLocation || null,
      temperament: form.temperament || null,
      specialHandling: form.specialHandling || null,
      dietaryNeeds: form.dietaryNeeds || null,
      identificationTags: form.identificationTags || null,
      notes: form.notes || null,
      weightKg: form.weightKg === "" ? null : Number(form.weightKg),
      acknowledgeDuplicates,
      version: existing.data?.version,
    };
    try {
      const result = await api<{ animal: Animal }>(animalId ? `/api/animals/${animalId}` : "/api/animals", { method: animalId ? "PATCH" : "POST", body: payload });
      setDirty(false);
      router.push(`/animals/${result.animal.id}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "duplicate_warning" && !acknowledgeDuplicates) {
        setError(caught);
      } else setError(caught instanceof ApiError ? caught : new ApiError(500, "error", "Could not save the animal."));
    } finally {
      setPending(false);
    }
  }

  const matches = (error?.details as { matches?: { publicCode: string; name: string }[] } | undefined)?.matches;
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <PageHeader title={animalId ? "Edit animal" : "Register animal"} subtitle="Leave unknown details blank. PawHaven does not invent missing history." />
      {error && error.code !== "duplicate_warning" ? <Alert>{error.message}</Alert> : null}
      <Card className="grid gap-3 md:grid-cols-2">
        <Field label="Name" error={error?.fields?.name}><TextInput required value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
        <Field label="Species"><Select value={form.species} onChange={(event) => update("species", event.target.value)}><option value="cat">Cat</option><option value="dog">Dog</option></Select></Field>
        <Field label="Shelter"><Select required value={form.shelterId} onChange={(event) => update("shelterId", event.target.value)}>{session?.shelters.filter((shelter) => shelter.active).map((shelter) => <option key={shelter.id} value={shelter.id}>{shelter.name}</option>)}</Select></Field>
        <Field label="Sex"><Select value={form.sex} onChange={(event) => update("sex", event.target.value)}><option value="unknown">Unknown</option><option value="female">Female</option><option value="male">Male</option></Select></Field>
        <Field label="Breed"><TextInput value={form.breed} onChange={(event) => update("breed", event.target.value)} disabled={form.breedUnknown} /></Field>
        <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.breedUnknown} onChange={(event) => update("breedUnknown", event.target.checked)} /> Breed unknown or mixed</label>
        <Field label="Birth date" hint="Leave blank if unknown"><TextInput type="date" value={form.birthDate} onChange={(event) => update("birthDate", event.target.value)} /></Field>
        <Field label="Estimated age (years)"><TextInput type="number" min={0} value={form.estimatedAgeYears} onChange={(event) => update("estimatedAgeYears", event.target.value)} /></Field>
        <Field label="Color"><TextInput value={form.color} onChange={(event) => update("color", event.target.value)} /></Field>
        <Field label="Microchip"><TextInput value={form.microchip} onChange={(event) => update("microchip", event.target.value)} /></Field>
        <Field label="Intake date" error={error?.fields?.intakeDate}><TextInput required type="datetime-local" value={form.intakeDate} onChange={(event) => update("intakeDate", event.target.value)} /></Field>
        <Field label="Intake source" error={error?.fields?.intakeSource}><Select value={form.intakeSource} onChange={(event) => update("intakeSource", event.target.value)}>{(org.data?.intakeSources ?? ["stray"]).map((source) => <option key={source} value={source}>{source.replaceAll("_", " ")}</option>)}</Select></Field>
        <Field label="Housing or kennel"><TextInput value={form.housingLocation} onChange={(event) => update("housingLocation", event.target.value)} /></Field>
        <Field label="Size"><Select value={form.size} onChange={(event) => update("size", event.target.value)}>{["unknown", "small", "medium", "large", "xlarge"].map((size) => <option key={size}>{size}</option>)}</Select></Field>
        <Field label="Activity"><Select value={form.activityLevel} onChange={(event) => update("activityLevel", event.target.value)}>{["unknown", "low", "moderate", "high"].map((level) => <option key={level}>{level}</option>)}</Select></Field>
        <Field label="Weight (kg)"><TextInput type="number" step="0.1" min={0} value={form.weightKg} onChange={(event) => update("weightKg", event.target.value)} /></Field>
        <Field label="Sterilization"><Select value={form.sterilizationStatus} onChange={(event) => update("sterilizationStatus", event.target.value)}><option value="unknown">Unknown</option><option value="intact">Intact</option><option value="sterilized">Sterilized</option></Select></Field>
        <Field label="Identification tags"><TextInput value={form.identificationTags} onChange={(event) => update("identificationTags", event.target.value)} /></Field>
        <div className="md:col-span-2"><Field label="Distinguishing features"><TextArea value={form.distinguishingFeatures} onChange={(event) => update("distinguishingFeatures", event.target.value)} /></Field></div>
        <div className="md:col-span-2"><Field label="Temperament"><TextArea value={form.temperament} onChange={(event) => update("temperament", event.target.value)} /></Field></div>
        <div className="md:col-span-2"><Field label="Special handling"><TextArea value={form.specialHandling} onChange={(event) => update("specialHandling", event.target.value)} /></Field></div>
        <div className="md:col-span-2"><Field label="Dietary needs"><TextArea value={form.dietaryNeeds} onChange={(event) => update("dietaryNeeds", event.target.value)} /></Field></div>
        <div className="md:col-span-2"><Field label="Notes"><TextArea value={form.notes} onChange={(event) => update("notes", event.target.value)} /></Field></div>
        {can(session, "animals.write") ? (
          <>
            <Field label="Previous owner name" hint="Only staff who can edit animals can see this later."><TextInput value={form.previousOwnerName} onChange={(event) => update("previousOwnerName", event.target.value)} /></Field>
            <Field label="Previous owner phone"><TextInput value={form.previousOwnerPhone} onChange={(event) => update("previousOwnerPhone", event.target.value)} /></Field>
            <Field label="Previous owner email"><TextInput type="email" value={form.previousOwnerEmail} onChange={(event) => update("previousOwnerEmail", event.target.value)} /></Field>
            <div className="md:col-span-2"><Field label="Previous owner notes"><TextArea value={form.previousOwnerNotes} onChange={(event) => update("previousOwnerNotes", event.target.value)} /></Field></div>
          </>
        ) : null}
      </Card>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save animal"}</Button>
      <Dialog open={error?.code === "duplicate_warning"} title="Possible duplicate" onClose={() => setError(null)}>
        <p className="text-sm text-muted">A similar animal is already registered. Continue only if this is a different animal.</p>
        <ul className="mt-2 list-disc pl-5 text-sm">{matches?.map((match) => <li key={match.publicCode}>{match.publicCode} · {match.name}</li>)}</ul>
        <div className="mt-4 flex gap-2">
          <Button onClick={(event) => void submit(event, true)}>Save anyway</Button>
          <Button variant="secondary" onClick={() => setError(null)}>Go back</Button>
        </div>
      </Dialog>
    </form>
  );
}

export function AnimalDetail({ animalId }: { animalId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const animalQuery = useQuery<Animal>(`/api/animals/${animalId}`);
  const timeline = useQuery<{ id: string; title: string; detail: string | null; at: string; kind: string }[]>(`/api/animals/${animalId}/timeline`);
  const org = useQuery<OrgConfig>(session?.organization ? "/api/organization" : null);
  const [dialog, setDialog] = useState<"status" | "transfer" | "outcome" | "archive" | null>(null);
  const [status, setStatus] = useState("available");
  const [note, setNote] = useState("");
  const [shelterId, setShelterId] = useState("");
  const [destination, setDestination] = useState("");
  const [outcome, setOutcome] = useState("reunited");
  const [error, setError] = useState<string | null>(null);
  const animal = animalQuery.data;

  async function act(path: string, body: unknown) {
    if (!animal) return;
    setError(null);
    try {
      await api(path, { body: { ...body as object, version: animal.version } });
      setDialog(null);
      await animalQuery.reload();
      await timeline.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the animal.");
    }
  }

  async function upload(file: File) {
    const form = new FormData();
    form.set("file", file);
    await api(`/api/animals/${animalId}/photos`, { form });
    await animalQuery.reload();
  }

  if (animalQuery.loading) return <p role="status">Loading animal…</p>;
  if (animalQuery.error || !animal) return <Alert>{animalQuery.error ?? "Animal not found."}</Alert>;
  const inCare = org.data?.catalog.filter((item) => item.category === "in_care" && item.key !== animal.status) ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title={`${animal.name}`} subtitle={`${animal.publicCode} · ${animal.shelter.name}${animal.ageLabel ? ` · ${animal.ageLabel}` : ""}`} action={<div className="flex flex-wrap gap-2">{can(session, "animals.write") ? <LinkButton href={`/animals/${animal.id}/edit`} variant="secondary">Edit</LinkButton> : null}{can(session, "medical.write") ? <LinkButton href={`/medical/new?animalId=${animal.id}`} variant="secondary">Add medical record</LinkButton> : null}{can(session, "adoptions.write") && animal.status !== "adopted" ? <LinkButton href={`/adoptions/new?animalId=${animal.id}`}>Start adoption</LinkButton> : null}</div>} />
      <div className="flex flex-wrap gap-2"><Badge tone={statusTone(animal.status)}>{animal.statusLabel}</Badge><Badge tone={statusTone(animal.medicalClearance)}>Clearance: {animal.medicalClearance.replaceAll("_", " ")}</Badge>{animal.archivedAt ? <Badge>Archived</Badge> : null}</div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Species" value={animal.species} />
            <Info label="Breed" value={animal.breedUnknown ? "Unknown or mixed" : animal.breed} />
            <Info label="Sex" value={animal.sex} />
            <Info label="Color" value={animal.color} />
            <Info label="Microchip" value={animal.microchip} />
            <Info label="Housing" value={animal.housingLocation} />
            <Info label="Size" value={animal.size} />
            <Info label="Activity" value={animal.activityLevel} />
            <Info label="Sterilization" value={animal.sterilizationStatus} />
            <Info label="Intake" value={`${new Date(animal.intakeDate).toLocaleString()} · ${animal.intakeSource.replaceAll("_", " ")}`} />
            <Info label="Temperament" value={animal.temperament} />
            <Info label="Handling" value={animal.specialHandling} />
            <Info label="Diet" value={animal.dietaryNeeds} />
            <Info label="Notes" value={animal.notes} />
            {animal.previousOwner ? <Info label="Previous owner" value={[animal.previousOwner.name, animal.previousOwner.phone, animal.previousOwner.email].filter(Boolean).join(" · ")} /> : null}
            {animal.medicalClearanceBasis ? <Info label="Clearance basis" value={animal.medicalClearanceBasis} /> : null}
          </dl>
          {can(session, "animals.write") ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDialog("status")}>Change status</Button>
              {can(session, "animals.transfer") && (session?.shelters.length ?? 0) > 1 ? <Button variant="secondary" onClick={() => setDialog("transfer")}>Transfer shelter</Button> : null}
              {(session?.shelters.length ?? 0) <= 1 ? <p className="text-sm text-muted">Internal transfer is available when the organization has another shelter.</p> : null}
              <Button variant="secondary" onClick={() => setDialog("outcome")}>Record outcome</Button>
              <Button variant="ghost" onClick={() => setDialog("archive")}>{animal.archivedAt ? "Restore" : "Archive"}</Button>
            </div>
          ) : null}
        </Card>
        <Card>
          <h2 className="font-display text-xl">Photos</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {animal.photos.length === 0 ? <p className="text-sm text-muted">No photos yet.</p> : animal.photos.map((photo) => (
              // Photos are authorized downloads, not public optimized assets.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={photo.id} src={photo.url} alt={`${animal.name} photo`} className="h-28 w-full rounded-lg object-cover" />
            ))}
          </div>
          {can(session, "animals.write") ? <label className="mt-3 block text-sm font-semibold">Add photo<input className="mt-1 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label> : null}
        </Card>
      </div>
      <Card>
        <h2 className="font-display text-xl">History</h2>
        {timeline.data && timeline.data.length === 0 ? <p className="mt-2 text-sm text-muted">No history yet.</p> : null}
        <ol className="mt-3 space-y-3">
          {timeline.data?.map((item) => <li key={item.id} className="border-l-2 border-forest-700 pl-3"><p className="font-semibold">{item.title}</p><p className="text-xs text-muted">{new Date(item.at).toLocaleString()}</p>{item.detail ? <p className="text-sm">{item.detail}</p> : null}</li>)}
        </ol>
      </Card>
      <Dialog open={dialog === "status"} title="Change status" onClose={() => setDialog(null)}>
        <Field label="New status"><Select value={status} onChange={(event) => setStatus(event.target.value)}>{inCare.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</Select></Field>
        <Field label="Note"><TextArea value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        <Button className="mt-3" onClick={() => void act(`/api/animals/${animal.id}/status`, { status, note: note || null })}>Save status</Button>
      </Dialog>
      <Dialog open={dialog === "transfer"} title="Transfer to another shelter" onClose={() => setDialog(null)}>
        <p className="mb-2 text-sm text-muted">The animal keeps the same ID and history. This does not mark the animal as transferred out.</p>
        <Field label="Destination shelter"><Select value={shelterId} onChange={(event) => setShelterId(event.target.value)}>{session?.shelters.filter((shelter) => shelter.id !== animal.shelter.id).map((shelter) => <option key={shelter.id} value={shelter.id}>{shelter.name}</option>)}</Select></Field>
        <Field label="Reason"><TextInput value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        <Button className="mt-3" onClick={() => void act(`/api/animals/${animal.id}/transfers`, { toShelterId: shelterId, reason: note })}>Transfer</Button>
      </Dialog>
      <Dialog open={dialog === "outcome"} title="Record outcome" onClose={() => setDialog(null)}>
        <Field label="Outcome"><Select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="reunited">Reunited with owner</option><option value="deceased">Deceased</option><option value="external_transfer">Transferred outside the organization</option><option value="return_to_care">Return transferred or reunited animal to care</option></Select></Field>
        {outcome === "external_transfer" ? <Field label="Destination"><TextInput value={destination} onChange={(event) => setDestination(event.target.value)} /></Field> : null}
        {outcome === "return_to_care" ? <Field label="Shelter"><Select value={shelterId} onChange={(event) => setShelterId(event.target.value)}>{session?.shelters.map((shelter) => <option key={shelter.id} value={shelter.id}>{shelter.name}</option>)}</Select></Field> : null}
        <Field label="Note"><TextArea value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        <Button className="mt-3" onClick={() => void act(`/api/animals/${animal.id}/outcomes`, { type: outcome, note: note || null, destination: destination || null, shelterId: shelterId || undefined })}>Record outcome</Button>
      </Dialog>
      <Dialog open={dialog === "archive"} title={animal.archivedAt ? "Restore record" : "Archive record"} onClose={() => setDialog(null)}>
        <p className="text-sm text-muted">Archiving hides the animal from everyday lists and keeps the history.</p>
        <Field label="Reason"><TextInput value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        <Button className="mt-3" variant={animal.archivedAt ? "primary" : "danger"} onClick={() => void act(`/api/animals/${animal.id}/${animal.archivedAt ? "unarchive" : "archive"}`, { reason: note || "Staff request" }).then(() => router.refresh())}>Confirm</Button>
      </Dialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><dt className="text-muted">{label}</dt><dd className="font-semibold">{value || "—"}</dd></div>;
}

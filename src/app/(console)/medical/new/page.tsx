"use client";

import { useSearchParams } from "next/navigation";
import { MedicalForm } from "@/features/care";

export default function Page() {
  const params = useSearchParams();
  return <MedicalForm animalId={params.get("animalId") ?? undefined} correcting={params.get("correct") ?? undefined} />;
}

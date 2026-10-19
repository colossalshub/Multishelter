"use client";

import { useParams } from "next/navigation";
import { MedicalDetail } from "@/features/care";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <MedicalDetail recordId={params.id} />;
}

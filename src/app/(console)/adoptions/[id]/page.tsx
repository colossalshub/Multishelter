"use client";

import { useParams } from "next/navigation";
import { AdoptionDetail } from "@/features/adoptions";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <AdoptionDetail applicationId={params.id} />;
}

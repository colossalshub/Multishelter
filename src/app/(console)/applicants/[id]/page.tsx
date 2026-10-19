"use client";

import { useParams } from "next/navigation";
import { ApplicantForm } from "@/features/adoptions";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <ApplicantForm applicantId={params.id} />;
}

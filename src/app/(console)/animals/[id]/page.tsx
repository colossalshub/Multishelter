"use client";

import { useParams } from "next/navigation";
import { AnimalDetail } from "@/features/animals";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <AnimalDetail animalId={params.id} />;
}

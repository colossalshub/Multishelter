"use client";

import { useParams } from "next/navigation";
import { AnimalForm } from "@/features/animals";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <AnimalForm animalId={params.id} />;
}

"use client";

import { useUser } from "@/components/useUser";
import { ProblemStudio } from "@/components/authoring/ProblemStudio";
import { Spinner } from "@/components/ui";

export default function NewProblemPage() {
  const { user, loading } = useUser(["admin"]);
  if (loading || !user) return <Spinner />;
  return <ProblemStudio />;
}

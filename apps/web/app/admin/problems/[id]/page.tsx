"use client";

import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Problem } from "@/lib/types";
import { useUser } from "@/components/useUser";
import { ProblemStudio } from "@/components/authoring/ProblemStudio";
import { Spinner } from "@/components/ui";

export default function EditProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useUser(["admin"]);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    if (user) api.get<Problem>(`/problems/${id}`).then(setProblem);
  }, [user, id]);

  if (loading || !user || !problem) return <Spinner />;
  return <ProblemStudio initial={problem} problemId={id} />;
}

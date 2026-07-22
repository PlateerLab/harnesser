"use client";

import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Problem } from "@/lib/types";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { ProblemForm } from "@/components/ProblemForm";
import { Spinner } from "@/components/ui";

export default function EditProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useUser(["admin"]);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    if (user) api.get<Problem>(`/problems/${id}`).then(setProblem);
  }, [user, id]);

  if (loading || !user || !problem) return <Spinner />;
  return (
    <Shell user={user}>
      <h1 className="mb-6 text-xl font-bold">문제 편집</h1>
      <ProblemForm initial={problem} problemId={id} />
    </Shell>
  );
}

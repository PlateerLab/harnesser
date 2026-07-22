"use client";

import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { ProblemForm } from "@/components/ProblemForm";
import { Spinner } from "@/components/ui";

export default function NewProblemPage() {
  const { user, loading } = useUser(["admin"]);
  if (loading || !user) return <Spinner />;
  return (
    <Shell user={user}>
      <h1 className="mb-6 text-xl font-bold">새 문제</h1>
      <ProblemForm />
    </Shell>
  );
}

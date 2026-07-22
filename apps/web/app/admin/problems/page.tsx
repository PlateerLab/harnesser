"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ProblemSummary } from "@/lib/types";
import { DIFFICULTY_LABEL, fmtDateTime } from "@/lib/format";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";

export default function ProblemsPage() {
  const { user, loading } = useUser(["admin"]);
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);

  useEffect(() => {
    if (user) api.get<ProblemSummary[]>("/problems").then(setProblems);
  }, [user]);

  if (loading || !user) return <Spinner />;

  return (
    <Shell user={user}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">문제 관리</h1>
        <Link href="/admin/problems/new">
          <Button>+ 새 문제</Button>
        </Link>
      </div>
      {!problems ? (
        <Spinner />
      ) : problems.length === 0 ? (
        <EmptyState message="등록된 문제가 없습니다." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                <th className="px-4 py-3">제목</th>
                <th className="px-4 py-3">난이도</th>
                <th className="px-4 py-3">테스트</th>
                <th className="px-4 py-3">생성일</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/problems/${p.id}`} className="font-medium hover:underline">
                      {p.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={p.difficulty} label={DIFFICULTY_LABEL[p.difficulty]} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{p.test_case_count}개</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDateTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Shell>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Assessment } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";

export default function AssessmentsPage() {
  const { user, loading } = useUser(["admin"]);
  const [rows, setRows] = useState<Assessment[] | null>(null);

  useEffect(() => {
    if (user) api.get<Assessment[]>("/assessments").then(setRows);
  }, [user]);

  if (loading || !user) return <Spinner />;

  return (
    <Shell user={user}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">시험 관리</h1>
        <Link href="/admin/assessments/new">
          <Button>+ 새 시험</Button>
        </Link>
      </div>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="등록된 시험이 없습니다." />
      ) : (
        <div className="space-y-4">
          {rows.map((a) => {
            const done = a.assignments.filter((x) => x.attempt_status && x.attempt_status !== "in_progress").length;
            return (
              <Card key={a.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/assessments/${a.id}`} className="text-lg font-bold hover:underline">
                        {a.title}
                      </Link>
                      <Badge
                        value={a.mode}
                        label={a.mode === "ai_assisted" ? "AI 활용" : "일반"}
                      />
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      문제 {a.problems.length}개 · {a.duration_min}분 · 배정 {a.assignments.length}명 · 완료 {done}명
                      {a.ends_at && ` · 마감 ${fmtDateTime(a.ends_at)}`}
                    </p>
                  </div>
                  <Link href={`/review?assessment_id=${a.id}`}>
                    <Button variant="secondary">결과 보기</Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

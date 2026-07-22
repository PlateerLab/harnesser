"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { Attempt, MyAssignment } from "@/lib/types";
import { fmtDateTime, STATUS_LABEL } from "@/lib/format";
import { useUser, logout } from "@/components/useUser";
import { Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";

export default function DashboardPage() {
  const { user, loading } = useUser(["candidate", "admin", "evaluator"]);
  const [assignments, setAssignments] = useState<MyAssignment[] | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    api.get<MyAssignment[]>("/my/assignments").then(setAssignments).catch((e) => setError(String(e.message)));
  }, [user]);

  const start = async (assessmentId: string) => {
    try {
      const attempt = await api.post<Attempt>(`/assessments/${assessmentId}/attempts`);
      router.push(`/attempts/${attempt.id}`);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "시작할 수 없습니다");
    }
  };

  if (loading || !user) return <Spinner label="불러오는 중..." />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">
            Harnesser<span className="text-violet-500">.</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {user.name}님, 배정된 시험 목록입니다.
          </p>
        </div>
        <Button variant="ghost" onClick={() => logout(router)}>
          로그아웃
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!assignments ? (
        <Spinner />
      ) : assignments.length === 0 ? (
        <EmptyState message="배정된 시험이 없습니다. 관리자에게 문의하세요." />
      ) : (
        <div className="space-y-4">
          {assignments.map((a) => (
            <Card key={a.assessment_id} className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold">{a.title}</h2>
                    <Badge
                      value={a.mode}
                      label={a.mode === "ai_assisted" ? "AI 활용 테스트" : "일반 코딩 테스트"}
                    />
                    {a.attempt_status && (
                      <Badge value={a.attempt_status} label={STATUS_LABEL[a.attempt_status]} />
                    )}
                  </div>
                  {a.description && <p className="mt-2 text-sm text-slate-600">{a.description}</p>}
                  <p className="mt-2 text-xs text-slate-400">
                    문제 {a.problem_count}개 · 제한시간 {a.duration_min}분
                    {a.starts_at && ` · 시작 가능 ${fmtDateTime(a.starts_at)}`}
                    {a.ends_at && ` · 마감 ${fmtDateTime(a.ends_at)}`}
                  </p>
                </div>
                <div className="shrink-0">
                  {a.attempt_status === "in_progress" ? (
                    <Button onClick={() => router.push(`/attempts/${a.attempt_id}`)}>이어서 응시</Button>
                  ) : a.attempt_status ? (
                    <Button variant="secondary" disabled>
                      응시 완료
                    </Button>
                  ) : (
                    <Button onClick={() => start(a.assessment_id)}>응시 시작</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

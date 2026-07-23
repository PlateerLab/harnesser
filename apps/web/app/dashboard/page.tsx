"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();

  const isStaff = user?.role === "admin" || user?.role === "evaluator";

  const load = useCallback(() => {
    api.get<MyAssignment[]>("/my/assignments").then(setAssignments).catch((e) => setError(String(e.message)));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const start = async (assessmentId: string) => {
    setBusyId(assessmentId);
    try {
      const attempt = await api.post<Attempt>(`/assessments/${assessmentId}/attempts`);
      router.push(`/attempts/${attempt.id}`);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "시작할 수 없습니다");
      setBusyId(null);
    }
  };

  const retake = async (a: MyAssignment) => {
    if (!a.attempt_id) return;
    if (!confirm("기존 응시 기록(이벤트/제출/AI 대화/평가)을 모두 삭제하고 다시 응시합니다. 계속할까요?")) return;
    setBusyId(a.assessment_id);
    try {
      await api.del(`/attempts/${a.attempt_id}`);
      const attempt = await api.post<Attempt>(`/assessments/${a.assessment_id}/attempts`);
      router.push(`/attempts/${attempt.id}`);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "다시 응시할 수 없습니다");
      setBusyId(null);
    }
  };

  if (loading || !user) return <Spinner label="불러오는 중..." />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">
            Harnesser<span className="text-violet-500">.</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {user.name}님, {isStaff ? "전체 시험 목록입니다." : "배정된 시험 목록입니다."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isStaff && (
            <Link
              href={user.role === "admin" ? "/admin/problems" : "/review"}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              ⚙️ 관리자 콘솔
            </Link>
          )}
          <Button variant="ghost" onClick={() => logout(router)}>
            로그아웃
          </Button>
        </div>
      </div>

      {isStaff && (
        <div className="mb-6 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          <b>스태프 미리보기 모드</b> — 배정 여부와 관계없이 모든 시험을 응시자와 동일한 화면에서 체험할 수 있고,
          완료한 응시는 <b>다시 응시</b>로 초기화할 수 있습니다. 체험 응시는 리뷰 목록에 <b>체험</b> 배지로 표시됩니다.
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!assignments ? (
        <Spinner />
      ) : assignments.length === 0 ? (
        <EmptyState message={isStaff ? "등록된 시험이 없습니다. 관리자 콘솔에서 시험을 만드세요." : "배정된 시험이 없습니다. 관리자에게 문의하세요."} />
      ) : (
        <div className="space-y-4">
          {assignments.map((a) => {
            const busy = busyId === a.assessment_id;
            const finished = a.attempt_status && a.attempt_status !== "in_progress";
            return (
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
                      {isStaff && !a.assigned && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">미배정</span>
                      )}
                    </div>
                    {a.description && <p className="mt-2 text-sm text-slate-600">{a.description}</p>}
                    <p className="mt-2 text-xs text-slate-400">
                      문제 {a.problem_count}개 · 제한시간 {a.duration_min}분
                      {a.starts_at && ` · 시작 가능 ${fmtDateTime(a.starts_at)}`}
                      {a.ends_at && ` · 마감 ${fmtDateTime(a.ends_at)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {a.attempt_status === "in_progress" ? (
                      <Button onClick={() => router.push(`/attempts/${a.attempt_id}`)}>이어서 응시</Button>
                    ) : finished ? (
                      isStaff ? (
                        <>
                          <Link
                            href={`/review/attempts/${a.attempt_id}`}
                            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            결과 리뷰
                          </Link>
                          <Button variant="secondary" onClick={() => retake(a)} disabled={busy}>
                            {busy ? "초기화 중..." : "🔄 다시 응시"}
                          </Button>
                        </>
                      ) : (
                        <Button variant="secondary" disabled>
                          응시 완료
                        </Button>
                      )
                    ) : (
                      <Button onClick={() => start(a.assessment_id)} disabled={busy}>
                        {busy ? "준비 중..." : "응시 시작"}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { ReviewAttemptRow } from "@/lib/types";
import { fmtDateTime, STATUS_LABEL } from "@/lib/format";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui";

function ReviewList() {
  const { user, loading } = useUser(["admin", "evaluator"]);
  const [rows, setRows] = useState<ReviewAttemptRow[] | null>(null);
  const searchParams = useSearchParams();
  const assessmentId = searchParams.get("assessment_id");

  useEffect(() => {
    if (!user) return;
    const q = assessmentId ? `?assessment_id=${assessmentId}` : "";
    api.get<ReviewAttemptRow[]>(`/review/attempts${q}`).then(setRows);
  }, [user, assessmentId]);

  if (loading || !user) return <Spinner />;

  return (
    <Shell user={user}>
      <h1 className="mb-6 text-xl font-bold">응시 리뷰</h1>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="응시 기록이 없습니다." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                <th className="px-4 py-3">응시자</th>
                <th className="px-4 py-3">시험</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">점수</th>
                <th className="px-4 py-3">기록</th>
                <th className="px-4 py-3">응시일</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 font-medium">
                      {r.candidate_name}
                      {r.is_staff && (
                        <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
                          체험
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">{r.candidate_email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span>{r.assessment_title}</span>
                      <Badge value={r.mode} label={r.mode === "ai_assisted" ? "AI" : "일반"} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={r.status} label={STATUS_LABEL[r.status]} />
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {r.total_score != null ? (
                      <span>
                        <b>{r.total_score}</b>
                        <span className="text-slate-400">/{r.max_score}</span>
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    이벤트 {r.event_count}
                    {r.ai_message_count > 0 && ` · AI ${r.ai_message_count}턴`}
                    {r.has_auto_eval && " · 자동평가 완료"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(r.started_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/review/attempts/${r.id}`}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    >
                      리뷰
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Shell>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ReviewList />
    </Suspense>
  );
}

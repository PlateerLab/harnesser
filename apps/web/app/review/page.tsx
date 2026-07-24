"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { ReviewAttemptRow } from "@/lib/types";
import { fmtDateTime, STATUS_LABEL } from "@/lib/format";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { DataTable } from "@/components/DataTable";
import { IconDelete, IconView } from "@/components/icons";
import { Badge, IconButton, SearchInput, Spinner } from "@/components/ui";

function ReviewList() {
  const { user, loading } = useUser(["admin", "evaluator"]);
  const [rows, setRows] = useState<ReviewAttemptRow[] | null>(null);
  const [q, setQ] = useState("");
  const searchParams = useSearchParams();
  const assessmentId = searchParams.get("assessment_id");

  const load = () => {
    const qs = assessmentId ? `?assessment_id=${assessmentId}` : "";
    return api.get<ReviewAttemptRow[]>(`/review/attempts${qs}`).then(setRows);
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, assessmentId]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows ?? [];
    return (rows ?? []).filter(
      (r) =>
        r.candidate_name.toLowerCase().includes(query) ||
        r.candidate_email.toLowerCase().includes(query) ||
        r.assessment_title.toLowerCase().includes(query),
    );
  }, [rows, q]);

  const remove = async (r: ReviewAttemptRow) => {
    if (!confirm(`${r.candidate_name}의 '${r.assessment_title}' 응시 기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await api.del(`/attempts/${r.id}`);
    load();
  };

  if (loading || !user) return <Spinner />;

  return (
    <Shell user={user}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">응시 리뷰</h1>
        <SearchInput value={q} onChange={setQ} placeholder="응시자/시험 검색..." />
      </div>
      {!rows ? (
        <Spinner />
      ) : (
        <DataTable
          rows={filtered}
          rowKey={(r) => r.id}
          empty={q ? "검색 결과가 없습니다." : "응시 기록이 없습니다."}
          columns={[
            {
              key: "candidate",
              header: "응시자",
              render: (r) => (
                <div>
                  <div className="flex items-center gap-1.5 font-medium">
                    {r.candidate_name}
                    {r.is_staff && (
                      <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
                        체험
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">{r.candidate_email}</div>
                </div>
              ),
            },
            {
              key: "assessment",
              header: "시험",
              render: (r) => (
                <div className="flex items-center gap-2">
                  <span>{r.assessment_title}</span>
                  <Badge value={r.mode} label={r.mode === "ai_assisted" ? "AI" : "일반"} />
                </div>
              ),
            },
            {
              key: "status",
              header: "상태",
              render: (r) => <Badge value={r.status} label={STATUS_LABEL[r.status]} />,
            },
            {
              key: "score",
              header: "점수",
              className: "font-mono",
              render: (r) =>
                r.total_score != null ? (
                  <span>
                    <b>{r.total_score}</b>
                    <span className="text-slate-400">/{r.max_score}</span>
                  </span>
                ) : (
                  "-"
                ),
            },
            {
              key: "records",
              header: "기록",
              className: "text-xs text-slate-500",
              render: (r) => (
                <>
                  이벤트 {r.event_count}
                  {r.ai_message_count > 0 && ` · AI ${r.ai_message_count}턴`}
                  {r.has_auto_eval && " · 자동평가 완료"}
                </>
              ),
            },
            {
              key: "started",
              header: "응시일",
              className: "text-xs text-slate-500",
              render: (r) => fmtDateTime(r.started_at),
            },
          ]}
          actions={(r) => (
            <>
              <IconButton title="리뷰 보기" href={`/review/attempts/${r.id}`}>
                <IconView />
              </IconButton>
              {user.role === "admin" && (
                <IconButton title="응시 기록 삭제" tone="danger" onClick={() => remove(r)}>
                  <IconDelete />
                </IconButton>
              )}
            </>
          )}
        />
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

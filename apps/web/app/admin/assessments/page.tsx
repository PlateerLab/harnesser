"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Assessment } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { DataTable } from "@/components/DataTable";
import { IconDelete, IconEdit, IconResults } from "@/components/icons";
import { Badge, Button, IconButton, Spinner } from "@/components/ui";

export default function AssessmentsPage() {
  const { user, loading } = useUser(["admin"]);
  const [rows, setRows] = useState<Assessment[] | null>(null);

  const load = () => api.get<Assessment[]>("/assessments").then(setRows);

  useEffect(() => {
    if (user) load();
  }, [user]);

  const remove = async (a: Assessment) => {
    if (!confirm(`'${a.title}' 시험을 삭제할까요? 응시 기록도 함께 삭제됩니다.`)) return;
    await api.del(`/assessments/${a.id}`);
    load();
  };

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
      ) : (
        <DataTable
          rows={rows}
          rowKey={(a) => a.id}
          empty="등록된 시험이 없습니다."
          columns={[
            {
              key: "title",
              header: "시험",
              render: (a) => (
                <div className="flex min-w-0 items-center gap-2">
                  <Link href={`/admin/assessments/${a.id}`} className="truncate font-medium hover:underline">
                    {a.title}
                  </Link>
                  <Badge value={a.mode} label={a.mode === "ai_assisted" ? "AI 활용" : "일반"} />
                </div>
              ),
            },
            {
              key: "problems",
              header: "문제",
              className: "text-slate-500",
              render: (a) => `${a.problems.length}개`,
            },
            {
              key: "duration",
              header: "제한시간",
              className: "text-slate-500",
              render: (a) => `${a.duration_min}분`,
            },
            {
              key: "assigned",
              header: "배정 / 완료",
              className: "text-slate-500",
              render: (a) => {
                const done = a.assignments.filter(
                  (x) => x.attempt_status && x.attempt_status !== "in_progress",
                ).length;
                return `${a.assignments.length}명 / ${done}명`;
              },
            },
            {
              key: "window",
              header: "응시 기간",
              className: "text-slate-500",
              render: (a) =>
                a.starts_at || a.ends_at
                  ? `${a.starts_at ? fmtDateTime(a.starts_at) : "즉시"} ~ ${a.ends_at ? fmtDateTime(a.ends_at) : "제한 없음"}`
                  : "상시",
            },
          ]}
          actions={(a) => (
            <>
              <IconButton title="편집" href={`/admin/assessments/${a.id}`}>
                <IconEdit />
              </IconButton>
              <IconButton title="결과 보기" href={`/review?assessment_id=${a.id}`}>
                <IconResults />
              </IconButton>
              <IconButton title="삭제" tone="danger" onClick={() => remove(a)}>
                <IconDelete />
              </IconButton>
            </>
          )}
        />
      )}
    </Shell>
  );
}

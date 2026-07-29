"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ProblemSummary } from "@/lib/types";
import { DIFFICULTY_LABEL, fmtDateTime } from "@/lib/format";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { DataTable } from "@/components/DataTable";
import { IconDelete, IconEdit } from "@/components/icons";
import { Badge, Button, IconButton, SearchInput, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";

const FILTERS = [
  { key: "all", label: "전체" },
  { key: "easy", label: "쉬움" },
  { key: "medium", label: "보통" },
  { key: "hard", label: "어려움" },
];

export default function ProblemsPage() {
  const { user, loading } = useUser(["admin"]);
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const { confirm } = useToast();

  const load = () => api.get<ProblemSummary[]>("/problems").then(setProblems);

  useEffect(() => {
    if (user) load();
  }, [user]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (problems ?? []).filter(
      (p) =>
        (filter === "all" || p.difficulty === filter) &&
        (!query || p.title.toLowerCase().includes(query)),
    );
  }, [problems, filter, q]);

  const remove = async (p: ProblemSummary) => {
    if (!(await confirm({ title: "문제를 삭제할까요?", message: p.title, danger: true, confirmLabel: "삭제" }))) return;
    await api.del(`/problems/${p.id}`);
    load();
  };

  if (loading || !user) return <Spinner />;

  return (
    <Shell user={user}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">문제 관리</h1>
        <div className="flex items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="문제 제목 검색..." />
          <Link href="/admin/problems/new">
            <Button>+ 새 문제</Button>
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count =
            f.key === "all"
              ? (problems ?? []).length
              : (problems ?? []).filter((p) => p.difficulty === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === f.key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {!problems ? (
        <Spinner />
      ) : (
        <DataTable
          rows={filtered}
          rowKey={(p) => p.id}
          empty={q ? "검색 결과가 없습니다." : filter === "all" ? "등록된 문제가 없습니다." : "해당 난이도의 문제가 없습니다."}
          columns={[
            {
              key: "title",
              header: "제목",
              render: (p) => (
                <Link href={`/admin/problems/${p.id}`} className="font-medium hover:underline">
                  {p.title}
                </Link>
              ),
            },
            {
              key: "difficulty",
              header: "난이도",
              render: (p) => <Badge value={p.difficulty} label={DIFFICULTY_LABEL[p.difficulty]} />,
            },
            {
              key: "tests",
              header: "테스트",
              className: "text-slate-500",
              render: (p) => `${p.test_case_count}개`,
            },
            {
              key: "created",
              header: "생성일",
              className: "text-slate-500",
              render: (p) => fmtDateTime(p.created_at),
            },
          ]}
          actions={(p) => (
            <>
              <IconButton title="편집" href={`/admin/problems/${p.id}`}>
                <IconEdit />
              </IconButton>
              <IconButton title="삭제" tone="danger" onClick={() => remove(p)}>
                <IconDelete />
              </IconButton>
            </>
          )}
        />
      )}
    </Shell>
  );
}

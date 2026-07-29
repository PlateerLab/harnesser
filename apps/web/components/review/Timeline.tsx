"use client";

import { useMemo, useState } from "react";
import type { EventRow } from "@/lib/types";
import { AWAY_EVENT_TYPES, EVENT_LABEL, fmtAwayMs, fmtOffset } from "@/lib/format";

const TYPE_COLOR: Record<string, string> = {
  attempt_started: "text-blue-600",
  attempt_finished: "text-emerald-600",
  attempt_expired: "text-slate-500",
  code_snapshot: "text-slate-500",
  paste: "text-red-600",
  focus_lost: "text-amber-600",
  focus_gained: "text-slate-400",
  tab_hidden: "text-amber-600",
  tab_visible: "text-slate-400",
  window_blur: "text-amber-600",
  window_focus: "text-slate-400",
  pointer_away: "text-amber-500",
  copy: "text-red-600",
  cut: "text-red-600",
  resize: "text-slate-500",
  net_offline: "text-red-600",
  net_online: "text-slate-400",
  page_enter: "text-sky-600",
  page_exit: "text-sky-600",
  run_requested: "text-blue-600",
  submit_requested: "text-violet-600",
  run_result: "text-blue-600",
  submit_result: "text-violet-600",
  ai_message: "text-violet-600",
  language_change: "text-slate-500",
};

const FILTERS: { key: string; label: string; types: string[] }[] = [
  { key: "all", label: "전체", types: [] },
  {
    key: "integrity",
    label: "이탈/복사/붙여넣기",
    types: [
      "paste", "copy", "cut",
      "focus_lost", "focus_gained",
      "tab_hidden", "tab_visible", "window_blur", "window_focus",
      "pointer_away", "net_offline", "net_online", "page_enter", "page_exit",
    ],
  },
  { key: "exec", label: "실행/제출", types: ["run_requested", "submit_requested", "run_result", "submit_result"] },
  { key: "ai", label: "AI 대화", types: ["ai_message"] },
  { key: "snapshot", label: "스냅샷", types: ["code_snapshot"] },
];

export function Timeline({
  events,
  startIso,
  problemTitles,
}: {
  events: EventRow[];
  startIso: string;
  problemTitles: Record<string, string>;
}) {
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter);
    if (!f || f.types.length === 0) return events;
    return events.filter((e) => f.types.includes(e.type));
  }, [events, filter]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f.label}
            {f.types.length > 0 && (
              <span className="ml-1 opacity-60">
                {events.filter((e) => f.types.includes(e.type)).length}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="space-y-0.5">
        {filtered.map((e) => {
          const color = TYPE_COLOR[e.type] || "text-slate-500";
          const detail = describe(e);
          const expandable = ["paste", "copy", "cut"].includes(e.type) && !!e.payload.text;
          return (
            <div key={e.id}>
              <div
                className={`flex items-baseline gap-3 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50 ${
                  expandable ? "cursor-pointer" : ""
                } ${
                  ["paste", "copy", "cut", "net_offline"].includes(e.type)
                    ? "bg-red-50/60"
                    : AWAY_EVENT_TYPES.includes(e.type)
                      ? "bg-amber-50/60"
                      : ""
                }`}
                onClick={() => expandable && setExpanded(expanded === e.id ? null : e.id)}
              >
                <span className="w-20 shrink-0 font-mono text-xs text-slate-400">
                  {fmtOffset(startIso, e.created_at)}
                </span>
                <span className={`shrink-0 font-medium ${color}`}>
                  {EVENT_LABEL[e.type] || e.type}
                </span>
                {e.problem_id && (
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 text-xs text-slate-500">
                    {problemTitles[e.problem_id] || "문제"}
                  </span>
                )}
                <span className="min-w-0 truncate text-xs text-slate-500">{detail}</span>
                {expandable && <span className="ml-auto text-xs text-slate-400">{expanded === e.id ? "접기" : "내용 보기"}</span>}
              </div>
              {expanded === e.id && (
                <pre className="mx-3 mb-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-red-200">
                  {String(e.payload.text ?? "")}
                </pre>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-400">해당 이벤트가 없습니다.</p>}
      </div>
    </div>
  );
}

function describe(e: EventRow): string {
  const p = e.payload;
  switch (e.type) {
    case "paste":
      return `${p.chars ?? "?"}자 붙여넣음`;
    case "copy":
    case "cut":
      return `${p.chars ?? "?"}자 ${e.type === "cut" ? "잘라냄" : "복사함"}`;
    case "tab_visible":
    case "window_focus":
    case "pointer_away":
      return p.away_ms != null ? `${fmtAwayMs(Number(p.away_ms))} 자리 비움` : "";
    case "resize":
      return `${p.from} → ${p.to}`;
    case "page_enter":
      return String(p.viewport ?? "");
    case "code_snapshot":
      return `${p.language ?? ""} · ${String(p.code ?? "").length}자`;
    case "run_requested":
    case "submit_requested":
      return String(p.language ?? "");
    case "run_result":
    case "submit_result":
      return `${p.verdict ?? ""}${p.score != null ? ` · ${p.score}점` : ""}`;
    case "ai_message":
      return `${p.role === "user" ? "응시자 질문" : "AI 응답"} · ${p.chars ?? 0}자`;
    case "language_change":
      return `${p.from} → ${p.to}`;
    default:
      return "";
  }
}

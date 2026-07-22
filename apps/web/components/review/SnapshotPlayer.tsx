"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EventRow } from "@/lib/types";
import { fmtOffset } from "@/lib/format";
import { CodeEditor, CodeDiff } from "../CodeEditor";

interface Snapshot {
  at: string;
  language: string;
  code: string;
}

/** 코드 스냅샷 재생기 — 슬라이더/자동재생/이전 스냅샷과의 diff 뷰 */
export function SnapshotPlayer({
  events,
  problemId,
  startIso,
}: {
  events: EventRow[];
  problemId: string;
  startIso: string;
}) {
  const snapshots = useMemo<Snapshot[]>(
    () =>
      events
        .filter((e) => e.type === "code_snapshot" && e.problem_id === problemId)
        .map((e) => ({
          at: e.created_at,
          language: String(e.payload.language ?? "python"),
          code: String(e.payload.code ?? ""),
        })),
    [events, problemId],
  );

  const [idx, setIdx] = useState(0);
  const [diffMode, setDiffMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setIdx(snapshots.length > 0 ? snapshots.length - 1 : 0);
    setPlaying(false);
  }, [problemId, snapshots.length]);

  useEffect(() => {
    if (playing) {
      playRef.current = setInterval(() => {
        setIdx((i) => {
          if (i >= snapshots.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        });
      }, 700);
    }
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, [playing, snapshots.length]);

  if (snapshots.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">이 문제의 코드 스냅샷이 없습니다.</p>;
  }

  const current = snapshots[Math.min(idx, snapshots.length - 1)];
  const prev = idx > 0 ? snapshots[idx - 1] : null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={() => setPlaying((v) => !v)}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          {playing ? "⏸ 정지" : "▶ 재생"}
        </button>
        <input
          type="range"
          min={0}
          max={snapshots.length - 1}
          value={idx}
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
          className="flex-1"
        />
        <span className="w-32 shrink-0 text-right font-mono text-xs text-slate-500">
          {idx + 1}/{snapshots.length} · {fmtOffset(startIso, current.at)}
        </span>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={diffMode}
            onChange={(e) => setDiffMode(e.target.checked)}
            disabled={!prev}
          />
          이전과 비교
        </label>
      </div>
      <div className="h-[480px] overflow-hidden rounded-xl border border-slate-800">
        {diffMode && prev ? (
          <CodeDiff language={current.language} original={prev.code} modified={current.code} />
        ) : (
          <CodeEditor language={current.language} value={current.code} readOnly />
        )}
      </div>
    </div>
  );
}

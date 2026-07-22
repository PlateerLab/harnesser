"use client";

import type { Execution } from "@/lib/types";
import { VERDICT_LABEL } from "@/lib/format";
import { Badge } from "./ui";

/** 실행/채점 결과 콘솔 (응시 화면 다크 테마) */
export function ExecutionResults({ execution }: { execution: Execution | null }) {
  if (!execution) {
    return (
      <div className="p-4 text-sm text-slate-500">
        코드를 실행하면 결과가 여기에 표시됩니다. <span className="text-slate-600">실행 = 예시 테스트만, 제출 = 전체 채점</span>
      </div>
    );
  }
  if (execution.status === "queued" || execution.status === "running") {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-slate-300">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-slate-200" />
        {execution.status === "queued" ? "채점 대기 중..." : "실행 중..."}
      </div>
    );
  }
  if (execution.verdict === "CE") {
    return (
      <div className="p-4">
        <Badge value="CE" label="컴파일 오류" />
        <pre className="dark-scroll mt-2 max-h-40 overflow-auto rounded bg-slate-950 p-3 text-xs text-red-300">
          {execution.compile_output || "(출력 없음)"}
        </pre>
      </div>
    );
  }
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-3">
        <Badge value={execution.verdict || "IE"} label={VERDICT_LABEL[execution.verdict || "IE"]} />
        <span className="text-sm text-slate-300">
          {execution.passed}/{execution.total} 테스트 통과
        </span>
        {execution.kind === "submit" && execution.score !== null && (
          <span className="text-sm font-bold text-slate-100">점수 {execution.score}</span>
        )}
      </div>
      <div className="space-y-2">
        {execution.results.map((r) => (
          <div key={r.test_id} className="rounded-lg bg-slate-950/70 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Badge value={r.verdict} label={VERDICT_LABEL[r.verdict]} />
              <span>
                테스트 {r.ordinal + 1} {r.is_sample ? "(예시)" : "(비공개)"}
              </span>
              {r.time_ms !== null && <span>{r.time_ms}ms</span>}
            </div>
            {r.is_sample && (
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <ConsoleBlock label="입력" text={r.input} />
                <ConsoleBlock label="기대 출력" text={r.expected_output} />
                <ConsoleBlock label="실제 출력" text={r.stdout} error={r.verdict !== "AC"} />
              </div>
            )}
            {r.stderr && r.is_sample && (
              <pre className="dark-scroll mt-2 max-h-24 overflow-auto rounded bg-black/50 p-2 text-xs text-orange-300">
                {r.stderr}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsoleBlock({ label, text, error }: { label: string; text: string | null; error?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-slate-500">{label}</div>
      <pre
        className={`dark-scroll max-h-24 overflow-auto whitespace-pre-wrap rounded bg-black/50 p-2 ${
          error ? "text-red-300" : "text-slate-200"
        }`}
      >
        {text ?? ""}
      </pre>
    </div>
  );
}

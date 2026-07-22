"use client";

import { use, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Evaluation, ReviewDetail } from "@/lib/types";
import {
  DIFFICULTY_LABEL,
  fmtDateTime,
  fmtDuration,
  fmtOffset,
  STATUS_LABEL,
  VERDICT_LABEL,
} from "@/lib/format";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, Field, inputCls, Spinner } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { CodeEditor } from "@/components/CodeEditor";
import { Timeline } from "@/components/review/Timeline";
import { SnapshotPlayer } from "@/components/review/SnapshotPlayer";

const TABS = ["개요", "타임라인", "코드 재생", "제출 기록", "AI 대화"] as const;

export default function ReviewAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useUser(["admin", "evaluator"]);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("개요");
  const [playerProblem, setPlayerProblem] = useState<string>("");
  const [autoEvalBusy, setAutoEvalBusy] = useState(false);

  const load = () =>
    api.get<ReviewDetail>(`/review/attempts/${id}`).then((d) => {
      setDetail(d);
      if (!playerProblem && d.problems.length > 0) setPlayerProblem(d.problems[0].id);
    });

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  const problemTitles = useMemo(
    () => Object.fromEntries((detail?.problems ?? []).map((p) => [p.id, p.title])),
    [detail],
  );

  const stats = useMemo(() => {
    if (!detail) return null;
    const ev = detail.events;
    const pastes = ev.filter((e) => e.type === "paste");
    return {
      snapshots: ev.filter((e) => e.type === "code_snapshot").length,
      pastes: pastes.length,
      pasteChars: pastes.reduce((s, e) => s + Number(e.payload.chars ?? 0), 0),
      focusLost: ev.filter((e) => e.type === "focus_lost").length,
      runs: detail.executions.filter((x) => x.kind === "run").length,
      submits: detail.executions.filter((x) => x.kind === "submit").length,
      aiTurns: detail.ai_messages.length,
      durationS:
        (new Date(detail.attempt.submitted_at ?? detail.attempt.deadline_at).getTime() -
          new Date(detail.attempt.started_at).getTime()) /
        1000,
    };
  }, [detail]);

  const runAutoEval = async () => {
    setAutoEvalBusy(true);
    try {
      await api.post<Evaluation>(`/review/attempts/${id}/autoeval`);
      await load();
      setTab("개요");
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "자동평가 실패");
    } finally {
      setAutoEvalBusy(false);
    }
  };

  if (loading || !user) return <Spinner />;
  if (!detail || !stats) return <Spinner label="응시 데이터 로딩 중..." />;

  const autoEval = detail.evaluations.find((e) => e.kind === "auto");

  return (
    <Shell user={user}>
      {/* 헤더 */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">
            {detail.candidate.name}
            <span className="ml-2 text-sm font-normal text-slate-400">{detail.candidate.email}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>{detail.assessment.title}</span>
            <Badge value={detail.assessment.mode} label={detail.assessment.mode === "ai_assisted" ? "AI 활용" : "일반"} />
            <Badge value={detail.attempt.status} label={STATUS_LABEL[detail.attempt.status]} />
            <span>
              {fmtDateTime(detail.attempt.started_at)} 시작 · {fmtDuration(stats.durationS)} 소요
            </span>
          </div>
        </div>
        <Button onClick={runAutoEval} disabled={autoEvalBusy}>
          {autoEvalBusy ? "AI 평가 중..." : autoEval ? "AI 자동평가 다시 실행" : "🤖 AI 자동평가 실행"}
        </Button>
      </div>

      {/* 요약 통계 */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        {detail.problems.map((p) => (
          <Card key={p.id} className="p-3 text-center">
            <div className="truncate text-xs text-slate-400">{p.title}</div>
            <div className="mt-1 text-lg font-black">
              {p.best_score != null ? `${Math.round((p.best_score / 100) * p.points)}` : "-"}
              <span className="text-xs font-normal text-slate-400">/{p.points}</span>
            </div>
            {p.best_verdict && <Badge value={p.best_verdict} label={VERDICT_LABEL[p.best_verdict]} />}
          </Card>
        ))}
        <StatCard label="실행/제출" value={`${stats.runs}/${stats.submits}`} />
        <StatCard label="붙여넣기" value={`${stats.pastes}회`} warn={stats.pastes > 0} sub={`${stats.pasteChars}자`} />
        <StatCard label="화면 이탈" value={`${stats.focusLost}회`} warn={stats.focusLost > 2} />
        {detail.assessment.mode === "ai_assisted" && <StatCard label="AI 대화" value={`${stats.aiTurns}턴`} />}
      </div>

      {/* 탭 */}
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.filter((t) => t !== "AI 대화" || detail.assessment.mode === "ai_assisted").map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "개요" && (
        <OverviewTab detail={detail} attemptId={id} onSaved={load} />
      )}

      {tab === "타임라인" && (
        <Card className="p-5">
          <Timeline events={detail.events} startIso={detail.attempt.started_at} problemTitles={problemTitles} />
        </Card>
      )}

      {tab === "코드 재생" && (
        <Card className="p-5">
          <div className="mb-4 flex gap-2">
            {detail.problems.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlayerProblem(p.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  playerProblem === p.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {p.title}
              </button>
            ))}
          </div>
          <SnapshotPlayer events={detail.events} problemId={playerProblem} startIso={detail.attempt.started_at} />
        </Card>
      )}

      {tab === "제출 기록" && <ExecutionsTab detail={detail} problemTitles={problemTitles} />}

      {tab === "AI 대화" && (
        <Card className="space-y-4 p-6">
          {detail.ai_messages.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">AI 대화 기록이 없습니다.</p>
          )}
          {detail.ai_messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "ml-12" : "mr-6"}>
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                <span className="font-semibold">{m.role === "user" ? "👤 응시자" : "🤖 AI"}</span>
                <span>{fmtOffset(detail.attempt.started_at, m.created_at)}</span>
                {m.problem_id && (
                  <span className="rounded bg-slate-100 px-1.5">{problemTitles[m.problem_id]}</span>
                )}
              </div>
              <div
                className={`rounded-xl px-4 py-3 text-sm ${
                  m.role === "user" ? "bg-violet-50 text-slate-800" : "border border-slate-200 bg-white"
                }`}
              >
                <Markdown>{m.content}</Markdown>
              </div>
            </div>
          ))}
        </Card>
      )}
    </Shell>
  );
}

function StatCard({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card className={`p-3 text-center ${warn ? "border-amber-300 bg-amber-50" : ""}`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-black ${warn ? "text-amber-600" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </Card>
  );
}

function OverviewTab({
  detail,
  attemptId,
  onSaved,
}: {
  detail: ReviewDetail;
  attemptId: string;
  onSaved: () => void;
}) {
  const [score, setScore] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  const autoEvals = detail.evaluations.filter((e) => e.kind === "auto");
  const humanEvals = detail.evaluations.filter((e) => e.kind === "human");

  const saveHuman = async () => {
    if (!summary.trim()) return alert("평가 의견을 입력하세요");
    setBusy(true);
    try {
      await api.post(`/review/attempts/${attemptId}/evaluations`, {
        scores: score ? { overall_score: Number(score) } : {},
        summary,
      });
      setScore("");
      setSummary("");
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h2 className="font-bold">🤖 AI 자동평가</h2>
        {autoEvals.length === 0 && (
          <Card className="p-6 text-center text-sm text-slate-400">
            아직 자동평가가 없습니다. 우측 상단 버튼으로 실행하세요.
          </Card>
        )}
        {autoEvals.map((ev) => {
          const s = ev.scores as {
            overall_score?: number;
            criteria?: Record<string, number | null>;
            strengths?: string[];
            concerns?: string[];
            integrity_flags?: string[];
          };
          return (
            <Card key={ev.id} className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-black">
                  {s.overall_score ?? "-"}
                  <span className="text-sm font-normal text-slate-400">/100</span>
                </span>
                <span className="text-xs text-slate-400">{fmtDateTime(ev.created_at)}</span>
              </div>
              {s.criteria && (
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries({
                    correctness: "정답성",
                    code_quality: "코드 품질",
                    process: "풀이 과정",
                    ai_utilization: "AI 활용",
                  }).map(([key, label]) =>
                    s.criteria![key] != null ? (
                      <div key={key} className="rounded-lg bg-slate-50 p-2 text-center">
                        <div className="text-xs text-slate-400">{label}</div>
                        <div className="font-bold">{s.criteria![key]}</div>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
              <div className="text-sm text-slate-700">
                <Markdown>{ev.summary}</Markdown>
              </div>
              {!!s.strengths?.length && (
                <div className="text-sm">
                  <span className="font-semibold text-emerald-600">강점</span>
                  <ul className="ml-4 list-disc text-slate-600">
                    {s.strengths.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!s.concerns?.length && (
                <div className="text-sm">
                  <span className="font-semibold text-amber-600">우려</span>
                  <ul className="ml-4 list-disc text-slate-600">
                    {s.concerns.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!s.integrity_flags?.length && (
                <div className="rounded-lg bg-red-50 p-3 text-sm">
                  <span className="font-semibold text-red-600">⚠️ 무결성 플래그</span>
                  <ul className="ml-4 list-disc text-red-700">
                    {s.integrity_flags.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="space-y-4">
        <h2 className="font-bold">✍️ 평가자 의견</h2>
        {humanEvals.map((ev) => (
          <Card key={ev.id} className="p-5">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-600">
                {ev.evaluator_name ?? "평가자"}
                {(ev.scores as { overall_score?: number }).overall_score != null &&
                  ` · ${(ev.scores as { overall_score?: number }).overall_score}점`}
              </span>
              <span>{fmtDateTime(ev.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{ev.summary}</p>
          </Card>
        ))}
        <Card className="space-y-3 p-5">
          <Field label="점수 (선택, 0~100)">
            <input
              className={inputCls}
              type="number"
              min={0}
              max={100}
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          </Field>
          <Field label="평가 의견">
            <textarea
              className={`${inputCls} min-h-28`}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="응시 과정, 코드 품질, AI 활용 태도 등에 대한 종합 의견"
            />
          </Field>
          <div className="flex justify-end">
            <Button onClick={saveHuman} disabled={busy}>
              평가 저장
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ExecutionsTab({
  detail,
  problemTitles,
}: {
  detail: ReviewDetail;
  problemTitles: Record<string, string>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {detail.executions.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-400">실행 기록이 없습니다.</p>
      )}
      {detail.executions.map((ex) => (
        <Card key={ex.id} className="p-4">
          <div
            className="flex cursor-pointer flex-wrap items-center gap-3 text-sm"
            onClick={() => setOpenId(openId === ex.id ? null : ex.id)}
          >
            <span className="font-mono text-xs text-slate-400">
              {fmtOffset(detail.attempt.started_at, ex.created_at)}
            </span>
            <Badge value={ex.kind === "submit" ? "ai_assisted" : "standard"} label={ex.kind === "submit" ? "제출" : "실행"} />
            <span className="font-medium">{problemTitles[ex.problem_id]}</span>
            <span className="text-slate-500">{ex.language}</span>
            {ex.verdict && <Badge value={ex.verdict} label={VERDICT_LABEL[ex.verdict]} />}
            {ex.score != null && <span className="font-bold">{ex.score}점</span>}
            <span className="ml-auto text-xs text-slate-400">{openId === ex.id ? "접기 ▲" : "코드/결과 보기 ▼"}</span>
          </div>
          {openId === ex.id && (
            <div className="mt-4 space-y-3">
              <div className="h-64 overflow-hidden rounded-lg border border-slate-800">
                <CodeEditor language={ex.language} value={ex.code} readOnly />
              </div>
              {ex.compile_output && (
                <pre className="max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-amber-200">
                  {ex.compile_output}
                </pre>
              )}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {ex.results.map((r, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-2 text-center text-xs">
                    <div className="text-slate-400">테스트 {i + 1}</div>
                    <Badge value={r.verdict} label={VERDICT_LABEL[r.verdict]} />
                    {r.time_ms != null && <div className="mt-1 text-slate-400">{r.time_ms}ms</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

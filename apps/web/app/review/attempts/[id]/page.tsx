"use client";

import { use, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Attempt, Evaluation, ReviewDetail } from "@/lib/types";
import {
  DIFFICULTY_LABEL,
  fmtDateTime,
  fmtDuration,
  fmtOffset,
  STATUS_LABEL,
  VERDICT_LABEL,
} from "@/lib/format";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, Field, inputCls, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Markdown } from "@/components/Markdown";
import { CodeEditor } from "@/components/CodeEditor";
import { Timeline } from "@/components/review/Timeline";
import { SnapshotPlayer } from "@/components/review/SnapshotPlayer";

const TABS = ["개요", "타임라인", "코드 재생", "제출 기록", "AI 대화"] as const;
type Tab = (typeof TABS)[number];

interface EvalProvider {
  id: string;
  name: string;
  provider: string;
  model: string;
  is_eval_default: boolean;
}

export default function ReviewAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useUser(["admin", "evaluator"]);
  const router = useRouter();
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [tab, setTab] = useState<Tab>("개요");
  // 시험 → 개별 문제 계층 필터: 타임라인/코드 재생/제출 기록/AI 대화에 공통 적용
  const [problemFilter, setProblemFilter] = useState<string>("all");
  const [retaking, setRetaking] = useState(false);
  const { toast } = useToast();

  const load = () => api.get<ReviewDetail>(`/review/attempts/${id}`).then(setDetail);

  const retake = async () => {
    setRetaking(true);
    try {
      const attempt = await api.post<Attempt>(`/attempts/${id}/retake`);
      router.push(`/attempts/${attempt.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "다시 체험할 수 없습니다", "error");
      setRetaking(false);
    }
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  const problemTitles = useMemo(
    () => Object.fromEntries((detail?.problems ?? []).map((p) => [p.id, p.title])),
    [detail],
  );

  // 공통(시험 단위) 지표
  const stats = useMemo(() => {
    if (!detail) return null;
    const ev = detail.events;
    const pastes = ev.filter((e) => e.type === "paste");
    const totalScore = detail.problems.reduce(
      (sum, p) => sum + (p.best_score != null ? (p.best_score / 100) * p.points : 0),
      0,
    );
    const maxScore = detail.problems.reduce((sum, p) => sum + p.points, 0);
    return {
      totalScore: Math.round(totalScore * 10) / 10,
      maxScore,
      pastes: pastes.length,
      pasteChars: pastes.reduce((s, e) => s + Number(e.payload.chars ?? 0), 0),
      copies: ev.filter((e) => e.type === "copy" || e.type === "cut").length,
      focusLost: ev.filter((e) => ["focus_lost", "tab_hidden", "window_blur"].includes(e.type)).length,
      runs: detail.executions.filter((x) => x.kind === "run").length,
      submits: detail.executions.filter((x) => x.kind === "submit").length,
      aiTurns: detail.ai_messages.filter((m) => m.role === "user").length,
      durationS:
        (new Date(detail.attempt.submitted_at ?? detail.attempt.deadline_at).getTime() -
          new Date(detail.attempt.started_at).getTime()) /
        1000,
    };
  }, [detail]);

  // 문제 필터 적용 데이터
  const scopedEvents = useMemo(() => {
    if (!detail) return [];
    if (problemFilter === "all") return detail.events;
    return detail.events.filter((e) => e.problem_id === problemFilter);
  }, [detail, problemFilter]);

  const scopedExecutions = useMemo(() => {
    if (!detail) return [];
    if (problemFilter === "all") return detail.executions;
    return detail.executions.filter((e) => e.problem_id === problemFilter);
  }, [detail, problemFilter]);

  const scopedAiMessages = useMemo(() => {
    if (!detail) return [];
    if (problemFilter === "all") return detail.ai_messages;
    return detail.ai_messages.filter((m) => m.problem_id === problemFilter);
  }, [detail, problemFilter]);

  // 코드 재생은 특정 문제가 필요 — '전체'면 첫 문제로
  const playerProblemId =
    problemFilter !== "all" ? problemFilter : (detail?.problems[0]?.id ?? "");

  const openProblemRecords = (problemId: string) => {
    setProblemFilter(problemId);
    setTab("제출 기록");
  };

  if (loading || !user) return <Spinner />;
  if (!detail || !stats) return <Spinner label="응시 데이터 로딩 중..." />;

  return (
    <Shell user={user}>
      {/* ── 헤더: 응시 공통 정보만 ── */}
      <div className="mb-5">
        <h1 className="text-xl font-bold">
          {detail.candidate.name}
          <span className="ml-2 text-sm font-normal text-slate-400">{detail.candidate.email}</span>
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span>{detail.assessment.title}</span>
          <Badge value={detail.assessment.mode} label={detail.assessment.mode === "ai_assisted" ? "AI 활용" : "일반"} />
          <Badge value={detail.attempt.status} label={STATUS_LABEL[detail.attempt.status]} />
          {detail.attempt.superseded && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
              재응시 이전 기록
            </span>
          )}
          <span>
            {fmtDateTime(detail.attempt.started_at)} 시작 · {fmtDuration(stats.durationS)} 소요
          </span>
        </div>
      </div>

      {/* 공통 지표 */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3 text-center">
          <div className="text-xs text-slate-400">총점</div>
          <div className="mt-1 text-lg font-black">
            {stats.totalScore}
            <span className="text-xs font-normal text-slate-400">/{stats.maxScore}</span>
          </div>
        </Card>
        <StatCard label="소요 시간" value={fmtDuration(stats.durationS)} />
        <StatCard label="실행 / 제출" value={`${stats.runs} / ${stats.submits}`} />
        <StatCard
          label="복사 / 붙여넣기"
          value={`${stats.copies} / ${stats.pastes}회`}
          warn={stats.pastes > 0 || stats.copies > 0}
          sub={`붙여넣기 ${stats.pasteChars}자`}
        />
        <StatCard label="화면 이탈" value={`${stats.focusLost}회`} warn={stats.focusLost > 2} />
        {detail.assessment.mode === "ai_assisted" ? (
          <StatCard label="AI 질문" value={`${stats.aiTurns}턴`} />
        ) : (
          <StatCard label="스냅샷" value={`${detail.events.filter((e) => e.type === "code_snapshot").length}회`} />
        )}
      </div>

      {/* ── 탭 + 문제 계층 필터 ── */}
      <div className="mb-3 flex gap-1 border-b border-slate-200">
        {TABS.filter((t) => t !== "AI 대화" || detail.assessment.mode === "ai_assisted").map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab !== "개요" && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">범위</span>
          {tab !== "코드 재생" && (
            <button
              onClick={() => setProblemFilter("all")}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
                problemFilter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              시험 전체
            </button>
          )}
          {detail.problems.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setProblemFilter(p.id)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
                problemFilter === p.id || (tab === "코드 재생" && playerProblemId === p.id)
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {i + 1}. {p.title}
            </button>
          ))}
        </div>
      )}

      {/* ── 탭 내용 ── */}
      {tab === "개요" && (
        <OverviewTab
          detail={detail}
          attemptId={id}
          onSaved={load}
          onOpenProblem={openProblemRecords}
          aiTurnsByProblem={detail.ai_messages.reduce<Record<string, number>>((acc, m) => {
            if (m.role === "user" && m.problem_id) acc[m.problem_id] = (acc[m.problem_id] ?? 0) + 1;
            return acc;
          }, {})}
        />
      )}

      {tab === "타임라인" && (
        <Card className="p-5">
          <Timeline events={scopedEvents} startIso={detail.attempt.started_at} problemTitles={problemTitles} />
        </Card>
      )}

      {tab === "코드 재생" && (
        <Card className="p-5">
          <SnapshotPlayer events={detail.events} problemId={playerProblemId} startIso={detail.attempt.started_at} />
        </Card>
      )}

      {tab === "제출 기록" && (
        <ExecutionsList detail={detail} executions={scopedExecutions} problemTitles={problemTitles} />
      )}

      {tab === "AI 대화" && (
        <Card className="space-y-4 p-6">
          {scopedAiMessages.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">
              {problemFilter === "all" ? "AI 대화 기록이 없습니다." : "이 문제에서의 AI 대화가 없습니다."}
            </p>
          )}
          {scopedAiMessages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "ml-12" : "mr-6"}>
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                <span className="font-semibold">{m.role === "user" ? "응시자" : "AI"}</span>
                <span>{fmtOffset(detail.attempt.started_at, m.created_at)}</span>
                {m.problem_id && problemFilter === "all" && (
                  <span className="rounded bg-slate-100 px-1.5">{problemTitles[m.problem_id]}</span>
                )}
                {m.model && m.role === "assistant" && <span className="text-slate-300">{m.model}</span>}
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

/** 개요 — 문제별 결과 + AI 자동평가(공급자 선택) + 평가자 의견 */
function OverviewTab({
  detail,
  attemptId,
  onSaved,
  onOpenProblem,
  aiTurnsByProblem,
}: {
  detail: ReviewDetail;
  attemptId: string;
  onSaved: () => void;
  onOpenProblem: (problemId: string) => void;
  aiTurnsByProblem: Record<string, number>;
}) {
  const [score, setScore] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<EvalProvider[]>([]);
  const [evalProviderId, setEvalProviderId] = useState("");
  const [evalBusy, setEvalBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    api.get<EvalProvider[]>("/review/ai-providers").then((rows) => {
      setProviders(rows);
      const def = rows.find((r) => r.is_eval_default) ?? rows[0];
      if (def) setEvalProviderId(def.id);
    });
  }, []);

  const autoEvals = detail.evaluations.filter((e) => e.kind === "auto");
  const humanEvals = detail.evaluations.filter((e) => e.kind === "human");

  const runAutoEval = async () => {
    setEvalBusy(true);
    try {
      await api.post<Evaluation>(`/review/attempts/${attemptId}/autoeval`, {
        provider_id: evalProviderId || null,
      });
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "자동평가 실패", "error");
    } finally {
      setEvalBusy(false);
    }
  };

  const saveHuman = async () => {
    if (!summary.trim()) return toast("평가 의견을 입력하세요", "info");
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
    <div className="space-y-6">
      {/* 문제별 결과 — 시험 → 문제 계층의 진입점 */}
      <Card>
        <div className="border-b border-slate-100 px-5 py-3 text-sm font-bold">문제별 결과</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-2.5 font-medium">문제</th>
              <th className="px-4 py-2.5 font-medium">점수</th>
              <th className="px-4 py-2.5 font-medium">최고 판정</th>
              <th className="px-4 py-2.5 font-medium">실행 / 제출</th>
              <th className="px-4 py-2.5 font-medium">AI 질문</th>
              <th className="px-4 py-2.5 font-medium">최종 언어</th>
              <th className="w-0 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {detail.problems.map((p, i) => {
              const runs = detail.executions.filter((e) => e.problem_id === p.id && e.kind === "run").length;
              const submits = detail.executions.filter((e) => e.problem_id === p.id && e.kind === "submit").length;
              const earned = p.best_score != null ? Math.round((p.best_score / 100) * p.points * 10) / 10 : null;
              return (
                <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {i + 1}. {p.title}
                      </span>
                      <Badge value={p.difficulty} label={DIFFICULTY_LABEL[p.difficulty]} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold">
                        {earned ?? "-"}
                        <span className="font-normal text-slate-400">/{p.points}</span>
                      </span>
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${
                            (p.best_score ?? 0) >= 100 ? "bg-emerald-500" : (p.best_score ?? 0) > 0 ? "bg-amber-400" : "bg-slate-200"
                          }`}
                          style={{ width: `${p.best_score ?? 0}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {p.deliverable === "report" ? (
                      p.report_submitted ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          보고서 제출됨
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600">
                          미제출
                        </span>
                      )
                    ) : p.best_verdict ? (
                      <Badge value={p.best_verdict} label={VERDICT_LABEL[p.best_verdict]} />
                    ) : (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600">
                        미제출
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {runs} / {submits}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{aiTurnsByProblem[p.id] ?? 0}턴</td>
                  <td className="px-4 py-3 text-slate-500">{p.final_language ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      onClick={() => onOpenProblem(p.id)}
                      className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-900"
                    >
                      기록 보기
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* AI 자동평가 */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">AI 자동평가</h2>
            <div className="flex items-center gap-2">
              <select
                className="max-w-52 truncate rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
                value={evalProviderId}
                onChange={(e) => setEvalProviderId(e.target.value)}
                disabled={evalBusy}
              >
                {providers.length === 0 && <option value="">공급자 없음</option>}
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.model}
                  </option>
                ))}
              </select>
              <Button onClick={runAutoEval} disabled={evalBusy || providers.length === 0}>
                {evalBusy ? "평가 중..." : autoEvals.length > 0 ? "다시 실행" : "실행"}
              </Button>
            </div>
          </div>
          {autoEvals.length === 0 && (
            <Card className="p-6 text-center text-sm text-slate-400">
              아직 자동평가가 없습니다. 공급자를 선택하고 실행하세요.
            </Card>
          )}
          {autoEvals.map((ev) => {
            const s = ev.scores as {
              overall_score?: number;
              criteria?: Record<string, number | null>;
              strengths?: string[];
              concerns?: string[];
              integrity_flags?: string[];
              evaluated_by?: { name?: string; model?: string };
            };
            return (
              <Card key={ev.id} className="space-y-4 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-black">
                    {s.overall_score ?? "-"}
                    <span className="text-sm font-normal text-slate-400">/100</span>
                  </span>
                  <div className="text-right text-xs text-slate-400">
                    <div>{fmtDateTime(ev.created_at)}</div>
                    {s.evaluated_by?.model && <div>{s.evaluated_by.model}</div>}
                  </div>
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
                    <span className="font-semibold text-red-600">무결성 플래그</span>
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

        {/* 평가자 의견 */}
        <div className="space-y-4">
          <h2 className="font-bold">평가자 의견</h2>
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
    </div>
  );
}

function ExecutionsList({
  detail,
  executions,
  problemTitles,
}: {
  detail: ReviewDetail;
  executions: ReviewDetail["executions"];
  problemTitles: Record<string, string>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {executions.length === 0 && (
        <Card>
          <p className="py-8 text-center text-sm text-slate-400">해당 범위의 실행 기록이 없습니다.</p>
        </Card>
      )}
      {executions.map((ex) => (
        <Card key={ex.id} className="p-4">
          <div
            className="flex cursor-pointer flex-wrap items-center gap-3 text-sm"
            onClick={() => setOpenId(openId === ex.id ? null : ex.id)}
          >
            <span className="font-mono text-xs text-slate-400">
              {fmtOffset(detail.attempt.started_at, ex.created_at)}
            </span>
            <span
              className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                ex.kind === "submit" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              {ex.kind === "submit" ? "제출" : "실행"}
            </span>
            <span className="font-medium">{problemTitles[ex.problem_id]}</span>
            <span className="text-slate-500">{ex.language}</span>
            {ex.language === "report" && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                보고서
              </span>
            )}
            {ex.verdict && <Badge value={ex.verdict} label={VERDICT_LABEL[ex.verdict]} />}
            {ex.score != null && <span className="font-bold">{ex.score}점</span>}
            <span className="ml-auto text-xs text-slate-400">
              {openId === ex.id ? "접기" : ex.language === "report" ? "보고서 보기" : "코드/결과 보기"}
            </span>
          </div>
          {openId === ex.id && (
            <div className="mt-4 space-y-3">
              {ex.language === "report" ? (
                <div className="max-h-[600px] overflow-auto rounded-lg border border-slate-200 p-5">
                  <Markdown>{ex.code}</Markdown>
                </div>
              ) : (
                <div className="h-64 overflow-hidden rounded-lg border border-slate-800">
                  <CodeEditor language={ex.language} value={ex.code} readOnly />
                </div>
              )}
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

"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { LANGUAGES, type Attempt, type Execution, type Language } from "@/lib/types";
import { DIFFICULTY_LABEL } from "@/lib/format";
import { useUser } from "@/components/useUser";
import { CodeEditor } from "@/components/CodeEditor";
import { Markdown } from "@/components/Markdown";
import { Timer } from "@/components/Timer";
import { AiChat } from "@/components/AiChat";
import { ExecutionResults } from "@/components/ExecutionResults";
import { Badge, Modal, Spinner } from "@/components/ui";

const SNAPSHOT_INTERVAL_MS = 20_000;

type CodeState = Record<string, { language: Language; codeByLang: Record<string, string> }>;

export default function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: attemptId } = use(params);
  const { user, loading } = useUser();
  const router = useRouter();

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [codeState, setCodeState] = useState<CodeState>({});
  const [executions, setExecutions] = useState<Record<string, Execution | null>>({});
  const [busy, setBusy] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [error, setError] = useState("");

  const codeStateRef = useRef(codeState);
  codeStateRef.current = codeState;
  const lastSnapshotRef = useRef<Record<string, string>>({});
  const finishedRef = useRef(false);

  // ── 초기 로드 ──────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    api
      .get<Attempt>(`/attempts/${attemptId}`)
      .then((a) => {
        if (a.status !== "in_progress") {
          alert("이미 종료된 시험입니다.");
          router.replace("/dashboard");
          return;
        }
        const init: CodeState = {};
        for (const p of a.problems) {
          const lang = (p.saved_language as Language) || "python";
          const codeByLang: Record<string, string> = { ...p.starter_code };
          if (p.saved_code) codeByLang[lang] = p.saved_code;
          init[p.id] = { language: lang, codeByLang };
        }
        setCodeState(init);
        setAttempt(a);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "불러오기 실패"));
  }, [user, attemptId, router]);

  // ── 이벤트 기록 ────────────────────────────────────────────
  const record = useCallback(
    (type: string, problemId: string | null, payload: Record<string, unknown> = {}) => {
      api
        .post(`/attempts/${attemptId}/events`, { events: [{ type, problem_id: problemId, payload }] })
        .catch(() => {});
    },
    [attemptId],
  );

  const snapshot = useCallback(
    (problemId: string, force = false) => {
      const st = codeStateRef.current[problemId];
      if (!st) return;
      const code = st.codeByLang[st.language] ?? "";
      const key = `${st.language}:${code}`;
      if (!force && lastSnapshotRef.current[problemId] === key) return;
      lastSnapshotRef.current[problemId] = key;
      record("code_snapshot", problemId, { language: st.language, code });
    },
    [record],
  );

  // 주기 스냅샷 (변경분만)
  useEffect(() => {
    if (!attempt) return;
    const t = setInterval(() => {
      for (const p of attempt.problems) snapshot(p.id);
    }, SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(t);
  }, [attempt, snapshot]);

  // 화면 이탈/복귀 기록
  useEffect(() => {
    if (!attempt) return;
    const onBlur = () => record("focus_lost", null, {});
    const onFocus = () => record("focus_gained", null, {});
    const onVisibility = () =>
      document.visibilityState === "hidden" ? onBlur() : onFocus();
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [attempt, record]);

  // ── 실행/제출 ──────────────────────────────────────────────
  const poll = useCallback(
    (executionId: string, problemId: string) => {
      const tick = async () => {
        try {
          const ex = await api.get<Execution>(`/executions/${executionId}`);
          setExecutions((prev) => ({ ...prev, [problemId]: ex }));
          if (ex.status === "queued" || ex.status === "running") {
            setTimeout(tick, 1200);
          } else {
            setBusy(false);
          }
        } catch {
          setBusy(false);
        }
      };
      tick();
    },
    [],
  );

  const execute = useCallback(
    async (kind: "run" | "submit") => {
      if (!attempt || busy) return;
      const problem = attempt.problems[activeIdx];
      const st = codeStateRef.current[problem.id];
      const code = st.codeByLang[st.language] ?? "";
      if (!code.trim()) {
        alert("코드를 작성해주세요.");
        return;
      }
      if (kind === "submit" && !confirm("전체 테스트로 채점합니다. 제출할까요?")) return;
      setBusy(true);
      snapshot(problem.id, true);
      try {
        const ex = await api.post<Execution>(`/attempts/${attemptId}/executions`, {
          problem_id: problem.id,
          kind,
          language: st.language,
          code,
        });
        setExecutions((prev) => ({ ...prev, [problem.id]: ex }));
        poll(ex.id, problem.id);
      } catch (e) {
        setBusy(false);
        alert(e instanceof ApiError ? e.message : "실행 요청 실패");
      }
    },
    [attempt, activeIdx, attemptId, busy, poll, snapshot],
  );

  // ── 종료 ──────────────────────────────────────────────────
  const finish = useCallback(async () => {
    if (finishedRef.current || !attempt) return;
    finishedRef.current = true;
    for (const p of attempt.problems) snapshot(p.id);
    try {
      await api.post(`/attempts/${attemptId}/finish`);
    } catch {
      /* 만료 후 자동처리 케이스 */
    }
    router.replace("/dashboard");
  }, [attempt, attemptId, router, snapshot]);

  if (loading || (!attempt && !error)) return <Spinner label="시험 준비 중..." />;
  if (error) return <div className="p-10 text-center text-red-600">{error}</div>;
  if (!attempt) return null;

  const problem = attempt.problems[activeIdx];
  const st = codeState[problem.id];
  const isAi = attempt.mode === "ai_assisted";

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      {/* 헤더 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-700 px-4">
        <div className="flex items-center gap-3">
          <span className="font-black">
            Harnesser<span className="text-violet-400">.</span>
          </span>
          <span className="max-w-md truncate text-sm text-slate-300">{attempt.assessment_title}</span>
          {isAi && <Badge value="ai_assisted" label="AI 활용" />}
        </div>
        <div className="flex items-center gap-3">
          {isAi && (
            <button
              onClick={() => setShowChat((v) => !v)}
              className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
            >
              {showChat ? "AI 패널 닫기" : "AI 패널 열기"}
            </button>
          )}
          <Timer initialSeconds={attempt.remaining_seconds} onExpire={finish} />
          <button
            onClick={() => setConfirmFinish(true)}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold hover:bg-red-500"
          >
            시험 종료
          </button>
        </div>
      </header>

      {/* 본문 3열: 지문 | 에디터+콘솔 | (AI 채팅) */}
      <div className="flex min-h-0 flex-1">
        {/* 지문 */}
        <div className="flex w-[38%] min-w-0 flex-col border-r border-slate-700">
          <div className="flex shrink-0 gap-1 border-b border-slate-700 px-2 pt-2">
            {attempt.problems.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setActiveIdx(i)}
                className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
                  i === activeIdx
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {i + 1}. {p.title}
              </button>
            ))}
          </div>
          <div className="dark-scroll min-h-0 flex-1 overflow-y-auto bg-slate-800 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Badge value={problem.difficulty} label={DIFFICULTY_LABEL[problem.difficulty]} />
              <span className="text-xs text-slate-400">
                배점 {problem.points} · 시간 {problem.time_limit_ms}ms · 메모리 {problem.memory_limit_mb}MB
              </span>
            </div>
            <Markdown dark>{problem.statement_md}</Markdown>
            {problem.samples.length > 0 && (
              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-bold text-slate-200">예시</h3>
                {problem.samples.map((s, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="mb-1 text-slate-400">입력 {i + 1}</div>
                      <pre className="dark-scroll overflow-auto rounded bg-slate-950 p-2 text-slate-200">{s.input}</pre>
                    </div>
                    <div>
                      <div className="mb-1 text-slate-400">출력 {i + 1}</div>
                      <pre className="dark-scroll overflow-auto rounded bg-slate-950 p-2 text-slate-200">{s.expected_output}</pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 에디터 + 콘솔 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-700 px-3">
            <select
              className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-sm"
              value={st.language}
              onChange={(e) => {
                const lang = e.target.value as Language;
                setCodeState((prev) => ({
                  ...prev,
                  [problem.id]: { ...prev[problem.id], language: lang },
                }));
                record("language_change", problem.id, { from: st.language, to: lang });
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => execute("run")}
                disabled={busy}
                className="rounded-lg border border-slate-600 px-4 py-1 text-sm hover:bg-slate-800 disabled:opacity-40"
              >
                실행
              </button>
              <button
                onClick={() => execute("submit")}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-1 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40"
              >
                제출
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <CodeEditor
              language={st.language}
              value={st.codeByLang[st.language] ?? ""}
              onChange={(code) =>
                setCodeState((prev) => ({
                  ...prev,
                  [problem.id]: {
                    ...prev[problem.id],
                    codeByLang: { ...prev[problem.id].codeByLang, [st.language]: code },
                  },
                }))
              }
              onPaste={(text) =>
                record("paste", problem.id, { chars: text.length, text: text.slice(0, 10000) })
              }
            />
          </div>
          <div className="flex h-56 shrink-0 flex-col border-t border-slate-700 bg-slate-900">
            <div className="flex h-8 shrink-0 items-center border-b border-slate-800 px-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
              실행 결과
            </div>
            <div className="dark-scroll min-h-0 flex-1 overflow-y-auto">
              <ExecutionResults execution={executions[problem.id] ?? null} />
            </div>
          </div>
        </div>

        {/* AI 채팅 */}
        {isAi && showChat && (
          <div className="w-[26rem] shrink-0 border-l border-slate-700 bg-slate-900">
            <AiChat attemptId={attemptId} problemId={problem.id} />
          </div>
        )}
      </div>

      {confirmFinish && (
        <Modal title="시험을 종료할까요?" onClose={() => setConfirmFinish(false)}>
          <p className="mb-4 text-sm text-slate-600">
            종료하면 다시 응시할 수 없습니다. 각 문제의 <b>제출</b>을 완료했는지 확인하세요.
          </p>
          <div className="flex justify-end gap-2">
            <button
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
              onClick={() => setConfirmFinish(false)}
            >
              계속 응시
            </button>
            <button
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white"
              onClick={finish}
            >
              최종 종료
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

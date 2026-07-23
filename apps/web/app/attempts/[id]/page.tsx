"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  LANGUAGES,
  type Attempt,
  type Execution,
  type ExecutionSummary,
  type Language,
} from "@/lib/types";
import { DIFFICULTY_LABEL, VERDICT_LABEL } from "@/lib/format";
import { useUser } from "@/components/useUser";
import { CodeEditor } from "@/components/CodeEditor";
import { Markdown } from "@/components/Markdown";
import { Timer } from "@/components/Timer";
import { AiChat } from "@/components/AiChat";
import { ExecutionResults } from "@/components/ExecutionResults";
import { Badge, Spinner } from "@/components/ui";

const SNAPSHOT_INTERVAL_MS = 20_000; // 리뷰 타임라인용 주기 스냅샷
const STATE_SAVE_DEBOUNCE_MS = 1_500; // 편집 멈춤 후 상태 저장 (새로고침 복원용)
const LAYOUT_KEY = "harnesser:exam-layout";

type CodeState = Record<string, { language: Language; codeByLang: Record<string, string> }>;

interface Layout {
  leftPct: number; // 지문 영역 너비 (%)
  chatW: number; // AI 패널 너비 (px)
  consoleH: number; // 실행 결과 높이 (px)
}

const DEFAULT_LAYOUT: Layout = { leftPct: 38, chatW: 416, consoleH: 224 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function sanitizeLayout(raw: unknown): Layout {
  const o = (raw ?? {}) as Partial<Record<keyof Layout, unknown>>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && isFinite(v) ? v : fallback);
  return {
    leftPct: clamp(num(o.leftPct, DEFAULT_LAYOUT.leftPct), 18, 60),
    chatW: clamp(num(o.chatW, DEFAULT_LAYOUT.chatW), 280, 720),
    consoleH: clamp(num(o.consoleH, DEFAULT_LAYOUT.consoleH), 96, 800),
  };
}

/** 패널 구분선 — 호버 시 강조, 드래그로 크기 조절 (포인터 캡처로 Monaco 위에서도 안정) */
function Divider({
  orientation,
  onMove,
}: {
  orientation: "vertical" | "horizontal";
  onMove: (clientX: number, clientY: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const base =
    "relative z-20 shrink-0 transition-colors " +
    (dragging ? "bg-violet-500" : "bg-slate-700/70 hover:bg-violet-500/80");
  const dims =
    orientation === "vertical"
      ? "w-1 cursor-col-resize after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5"
      : "h-1 cursor-row-resize after:absolute after:inset-x-0 after:-top-1.5 after:-bottom-1.5";
  return (
    <div
      className={`${base} ${dims} after:content-['']`}
      onPointerDown={(e) => {
        e.preventDefault();
        setDragging(true);
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => onMove(ev.clientX, ev.clientY);
        const up = (ev: PointerEvent) => {
          el.releasePointerCapture(ev.pointerId);
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          setDragging(false);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      }}
    />
  );
}

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
  const [submitStatus, setSubmitStatus] = useState<ExecutionSummary[] | null>(null);
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const mainRef = useRef<HTMLDivElement>(null);
  const editorColRef = useRef<HTMLDivElement>(null);

  // 레이아웃 복원/저장 (localStorage)
  useEffect(() => {
    try {
      setLayout(sanitizeLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}")));
    } catch {
      /* 기본값 유지 */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* 저장 실패 무시 */
    }
  }, [layout]);

  const onStatementResize = useCallback((clientX: number) => {
    const r = mainRef.current?.getBoundingClientRect();
    if (!r) return;
    setLayout((l) => ({ ...l, leftPct: clamp(((clientX - r.left) / r.width) * 100, 18, 60) }));
  }, []);
  const onChatResize = useCallback((clientX: number) => {
    const r = mainRef.current?.getBoundingClientRect();
    if (!r) return;
    setLayout((l) => ({ ...l, chatW: clamp(r.right - clientX, 280, 720) }));
  }, []);
  const onConsoleResize = useCallback((_x: number, clientY: number) => {
    const r = editorColRef.current?.getBoundingClientRect();
    if (!r) return;
    setLayout((l) => ({ ...l, consoleH: clamp(r.bottom - clientY, 96, r.height - 160) }));
  }, []);

  const codeStateRef = useRef(codeState);
  codeStateRef.current = codeState;
  const lastSnapshotRef = useRef<Record<string, string>>({});
  const lastStateSaveRef = useRef<Record<string, string>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);

  // ── 초기 로드: 상태 복원 + 진행 중이던 실행 결과 복원 ──────────
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
          // 우선순위: 언어별 저장분 > 마지막 스냅샷 > 시작 코드
          const codeByLang: Record<string, string> = {
            ...p.starter_code,
            ...(p.saved_code_by_lang || {}),
          };
          if (p.saved_code) codeByLang[lang] = p.saved_code;
          init[p.id] = { language: lang, codeByLang };
        }
        setCodeState(init);
        setAttempt(a);
        restoreExecutions(a);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "불러오기 실패"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, attemptId, router]);

  const restoreExecutions = useCallback(
    async (a: Attempt) => {
      try {
        const list = await api.get<ExecutionSummary[]>(`/attempts/${attemptId}/executions`);
        const latest: Record<string, ExecutionSummary> = {};
        for (const e of list) latest[e.problem_id] = e; // 시간순 → 마지막이 최신
        for (const p of a.problems) {
          const s = latest[p.id];
          if (!s) continue;
          const detail = await api.get<Execution>(`/executions/${s.id}`);
          setExecutions((prev) => ({ ...prev, [p.id]: detail }));
          if (detail.status === "queued" || detail.status === "running") {
            poll(detail.id, p.id); // 새로고침 전에 돌던 채점 폴링 재개
          }
        }
      } catch {
        /* 복원 실패는 치명적이지 않음 */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attemptId],
  );

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

  // ── 상태 저장 (새로고침/이탈 복원용) ────────────────────────
  const saveState = useCallback(
    (problemId: string, force = false) => {
      const st = codeStateRef.current[problemId];
      if (!st || finishedRef.current) return;
      const key = JSON.stringify([st.language, st.codeByLang]);
      if (!force && lastStateSaveRef.current[problemId] === key) return;
      lastStateSaveRef.current[problemId] = key;
      api
        .post(`/attempts/${attemptId}/state`, {
          problem_id: problemId,
          language: st.language,
          code_by_lang: st.codeByLang,
        })
        .catch(() => {
          // 실패 시 다음 저장에서 재시도되도록 마킹 해제
          delete lastStateSaveRef.current[problemId];
        });
    },
    [attemptId],
  );

  const scheduleStateSave = useCallback(
    (problemId: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveState(problemId), STATE_SAVE_DEBOUNCE_MS);
    },
    [saveState],
  );

  const flushAll = useCallback(() => {
    if (!attempt || finishedRef.current) return;
    for (const p of attempt.problems) {
      snapshot(p.id);
      saveState(p.id);
    }
  }, [attempt, snapshot, saveState]);

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
    const onVisibility = () => (document.visibilityState === "hidden" ? onBlur() : onFocus());
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [attempt, record]);

  // 새로고침/창닫기/뒤로가기: 마지막 상태를 sendBeacon으로 플러시 + 이탈 경고
  useEffect(() => {
    if (!attempt) return;
    const beacon = () => {
      if (finishedRef.current) return;
      for (const p of attempt.problems) {
        const st = codeStateRef.current[p.id];
        if (!st) continue;
        const body = JSON.stringify({
          problem_id: p.id,
          language: st.language,
          code_by_lang: st.codeByLang,
        });
        navigator.sendBeacon(
          `/api/attempts/${attemptId}/state`,
          new Blob([body], { type: "application/json" }),
        );
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      beacon();
      if (!finishedRef.current) {
        e.preventDefault();
        e.returnValue = ""; // 브라우저 기본 이탈 경고
      }
    };
    window.addEventListener("pagehide", beacon);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", beacon);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [attempt, attemptId]);

  // ── 실행/제출 ──────────────────────────────────────────────
  const poll = useCallback((executionId: string, problemId: string) => {
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
  }, []);

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
      saveState(problem.id, true);
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
    [attempt, activeIdx, attemptId, busy, poll, snapshot, saveState],
  );

  // ── 종료 ──────────────────────────────────────────────────
  const openFinishModal = useCallback(async () => {
    setSubmitStatus(null);
    setConfirmFinish(true);
    flushAll();
    try {
      setSubmitStatus(await api.get<ExecutionSummary[]>(`/attempts/${attemptId}/executions`));
    } catch {
      setSubmitStatus([]);
    }
  }, [attemptId, flushAll]);

  const finish = useCallback(async () => {
    if (finishedRef.current || !attempt) return;
    for (const p of attempt.problems) {
      snapshot(p.id, true);
      saveState(p.id, true);
    }
    finishedRef.current = true;
    try {
      await api.post(`/attempts/${attemptId}/finish`);
    } catch {
      /* 만료 후 자동처리 케이스 */
    }
    router.replace("/dashboard");
  }, [attempt, attemptId, router, snapshot, saveState]);

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
            onClick={openFinishModal}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold hover:bg-red-500"
          >
            시험 종료
          </button>
        </div>
      </header>

      {/* 본문 3열: 지문 | 에디터+콘솔 | (AI 채팅) — 구분선 드래그로 크기 조절 */}
      <div ref={mainRef} className="flex min-h-0 flex-1">
        {/* 지문 */}
        <div className="flex min-w-0 flex-col" style={{ width: `${layout.leftPct}%` }}>
          <div className="flex shrink-0 gap-1 border-b border-slate-700 px-2 pt-2">
            {attempt.problems.map((p, i) => (
              <button
                key={p.id}
                onClick={() => {
                  saveState(problem.id); // 탭 전환 전 현재 문제 저장
                  setActiveIdx(i);
                }}
                className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
                  i === activeIdx ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
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

        <Divider orientation="vertical" onMove={onStatementResize} />

        {/* 에디터 + 콘솔 */}
        <div ref={editorColRef} className="flex min-w-0 flex-1 flex-col">
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
                scheduleStateSave(problem.id);
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
              onChange={(code) => {
                setCodeState((prev) => ({
                  ...prev,
                  [problem.id]: {
                    ...prev[problem.id],
                    codeByLang: { ...prev[problem.id].codeByLang, [st.language]: code },
                  },
                }));
                scheduleStateSave(problem.id);
              }}
              onPaste={(text) =>
                record("paste", problem.id, { chars: text.length, text: text.slice(0, 10000) })
              }
            />
          </div>
          <Divider orientation="horizontal" onMove={onConsoleResize} />
          <div
            className="flex shrink-0 flex-col bg-slate-900"
            style={{ height: layout.consoleH, maxHeight: "75%" }}
          >
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
          <>
            <Divider orientation="vertical" onMove={onChatResize} />
            <div className="shrink-0 bg-slate-900" style={{ width: layout.chatW }}>
              <AiChat attemptId={attemptId} problemId={problem.id} />
            </div>
          </>
        )}
      </div>

      {confirmFinish && (
        <FinishModal
          attempt={attempt}
          submitStatus={submitStatus}
          onClose={() => setConfirmFinish(false)}
          onFinish={finish}
        />
      )}
    </div>
  );
}

/** 시험 종료 확인 모달 — 문제별 제출 현황을 보여주는 다크 테마 모달 */
function FinishModal({
  attempt,
  submitStatus,
  onClose,
  onFinish,
}: {
  attempt: Attempt;
  submitStatus: ExecutionSummary[] | null;
  onClose: () => void;
  onFinish: () => void;
}) {
  const [finishing, setFinishing] = useState(false);

  const bestSubmit: Record<string, ExecutionSummary> = {};
  for (const e of submitStatus ?? []) {
    if (e.kind !== "submit") continue;
    const cur = bestSubmit[e.problem_id];
    if (!cur || (e.score ?? -1) > (cur.score ?? -1)) bestSubmit[e.problem_id] = e;
  }
  const unsubmitted = attempt.problems.filter((p) => !bestSubmit[p.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 text-slate-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-white">시험을 종료할까요?</h3>
        <p className="mt-1.5 text-sm text-slate-400">
          종료하면 다시 응시할 수 없습니다. 문제별 제출 현황을 확인하세요.
        </p>

        <div className="mt-4 space-y-2">
          {submitStatus === null ? (
            <div className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-slate-300" />
              제출 현황 확인 중...
            </div>
          ) : (
            attempt.problems.map((p, i) => {
              const best = bestSubmit[p.id];
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg bg-slate-900/60 px-4 py-2.5"
                >
                  <span className="min-w-0 truncate text-sm text-slate-200">
                    {i + 1}. {p.title}
                  </span>
                  {best ? (
                    best.status === "done" ? (
                      <span className="flex shrink-0 items-center gap-2 text-xs">
                        <Badge value={best.verdict ?? "IE"} label={VERDICT_LABEL[best.verdict ?? "IE"]} />
                        {best.score != null && (
                          <span className="font-semibold text-slate-300">{best.score}점</span>
                        )}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-blue-300">채점 중</span>
                    )
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                      미제출
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {submitStatus !== null && unsubmitted.length > 0 && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            제출하지 않은 문제가 {unsubmitted.length}개 있습니다. 제출하지 않은 문제는 0점 처리됩니다.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
            onClick={onClose}
          >
            계속 응시
          </button>
          <button
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            disabled={finishing}
            onClick={() => {
              setFinishing(true);
              onFinish();
            }}
          >
            {finishing ? "종료 중..." : "최종 종료"}
          </button>
        </div>
      </div>
    </div>
  );
}

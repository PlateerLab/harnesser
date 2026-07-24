"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamAiChat } from "@/lib/api";
import type { AiMessage, AiUsage } from "@/lib/types";
import { Markdown } from "./Markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  problemId?: string | null;
  streaming?: boolean;
}

type ConnState = "connecting" | "online" | "fallback";

const HEARTBEAT_MS = 25_000;
const STALE_MS = 45_000; // pong/트래픽이 이 시간 없으면 재접속
const MAX_WS_FAILURES = 3; // 연속 실패 시 SSE 폴백

/** AI 활용 테스트 채팅 — WebSocket 스트리밍 (재접속 리플레이/하트비트/SSE 폴백). */
export function AiChat({ attemptId, problemId }: { attemptId: string; problemId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const scrollRef = useRef<HTMLDivElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);
  const failuresRef = useRef(0);
  const lastAliveRef = useRef(Date.now());
  const streamReqRef = useRef<string | null>(null);
  const streamProblemRef = useRef<string | null>(null);
  const problemIdRef = useRef(problemId);
  problemIdRef.current = problemId;

  const configured = usage === null ? null : usage.configured !== false;
  const exhausted = usage !== null && usage.remaining <= 0;

  // 현재 턴의 누적 텍스트 — 말풍선 재구성(리플레이/탭 복귀)에도 유실이 없도록 단일 출처로 유지
  const streamTextRef = useRef("");

  const refreshUsage = useCallback(() => {
    api.get<AiUsage>(`/attempts/${attemptId}/ai/usage`).then(setUsage).catch(() => {});
  }, [attemptId]);

  const streamingVisible = useCallback(
    () =>
      streamReqRef.current !== null &&
      (!streamProblemRef.current || streamProblemRef.current === problemIdRef.current),
    [],
  );

  /** 서버 메시지 목록으로 동기화. 진행 중 턴이 보이는 스레드면 누적 텍스트로 말풍선을 복원한다. */
  const loadMessages = useCallback(() => {
    return api
      .get<AiMessage[]>(`/attempts/${attemptId}/ai/messages?problem_id=${problemIdRef.current}`)
      .then((rows) => {
        const base: ChatMessage[] = rows.map((m) => ({
          role: m.role,
          content: m.content,
          problemId: m.problem_id,
        }));
        if (streamingVisible()) {
          base.push({ role: "assistant", content: streamTextRef.current, streaming: true });
        }
        setMessages(base);
      })
      .catch(() => {});
  }, [attemptId, streamingVisible]);

  // 델타 반영 — 누적 ref가 진실이며, 말풍선은 누적값으로 덮어써 순서 레이스에 안전
  const appendDelta = useCallback(
    (reqId: string, text: string) => {
      if (streamReqRef.current !== reqId) return;
      streamTextRef.current += text;
      if (!streamingVisible()) return;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.streaming) {
          next[next.length - 1] = { ...last, content: streamTextRef.current };
          return next;
        }
        // 말풍선이 없으면(동기화 레이스) 새로 만든다
        return [...next, { role: "assistant", content: streamTextRef.current, streaming: true }];
      });
    },
    [streamingVisible],
  );

  const finalizeStream = useCallback(
    (error?: string | null, cancelled?: boolean) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.streaming) {
          let content = last.content;
          if (error) content += `\n\n> 오류: ${error}`;
          if (cancelled) content += "\n\n> (중단됨)";
          next[next.length - 1] = { ...last, content, streaming: false };
        }
        return next;
      });
      streamReqRef.current = null;
      streamProblemRef.current = null;
      streamTextRef.current = "";
      setBusy(false);
    },
    [],
  );

  // ── WebSocket 연결 관리 ─────────────────────────────────────
  useEffect(() => {
    closedRef.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (closedRef.current || failuresRef.current >= MAX_WS_FAILURES) {
        if (failuresRef.current >= MAX_WS_FAILURES) setConn("fallback");
        return;
      }
      setConn("connecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/attempts/${attemptId}/ai/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        const wasReconnect = failuresRef.current > 0;
        failuresRef.current = 0;
        lastAliveRef.current = Date.now();
        setConn("online");
        if (wasReconnect) loadMessages(); // 끊긴 사이 놓친 턴 완료분 동기화
      };

      ws.onmessage = (raw) => {
        lastAliveRef.current = Date.now();
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(String(raw.data));
        } catch {
          return;
        }
        switch (ev.type) {
          case "ready": {
            const u = (ev.usage ?? {}) as { used: number; max: number; remaining: number };
            setUsage({
              enabled: true,
              ...u,
              configured: ev.configured as boolean,
              model: (ev.model as string) ?? null,
              provider: (ev.provider as string) ?? null,
            });
            // 진행 중 턴이 없는데 대기 상태라면(끊긴 사이 턴 종료) 잠금 해제 + 동기화
            if (!ev.active_req_id && streamReqRef.current) {
              finalizeStream();
              loadMessages();
            }
            break;
          }
          case "turn_start": {
            streamReqRef.current = ev.req_id as string;
            streamProblemRef.current = (ev.problem_id as string) ?? null;
            if (!ev.replay) streamTextRef.current = ""; // 리플레이는 델타로 누적을 다시 채운다
            setBusy(true);
            if (ev.replay) {
              // 재접속 리플레이 — 서버 목록과 동기화하면 loadMessages가
              // 누적 텍스트로 스트리밍 말풍선까지 복원한다 (레이스 없음)
              streamTextRef.current = "";
              loadMessages();
            } else if (!streamProblemRef.current || streamProblemRef.current === problemIdRef.current) {
              setMessages((prev) =>
                prev[prev.length - 1]?.streaming
                  ? prev
                  : [...prev, { role: "assistant", content: "", streaming: true }],
              );
            }
            break;
          }
          case "delta":
            appendDelta(ev.req_id as string, ev.text as string);
            break;
          case "turn_end": {
            finalizeStream(ev.error as string | null, ev.cancelled as boolean);
            const u = ev.usage as { used: number; max: number; remaining: number } | null;
            if (u) setUsage((prev) => (prev ? { ...prev, ...u } : prev));
            else refreshUsage();
            break;
          }
          case "error": {
            const msg = ev.message as string;
            if (streamReqRef.current && ev.req_id === streamReqRef.current) {
              finalizeStream(msg);
            } else {
              setMessages((prev) => {
                // 낙관적 말풍선이 있으면 오류로 마감, 없으면 시스템 안내
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.streaming) {
                  next[next.length - 1] = { ...last, content: `> 오류: ${msg}`, streaming: false };
                  return next;
                }
                return [...prev, { role: "assistant", content: `> 오류: ${msg}` }];
              });
              setBusy(false);
              refreshUsage();
            }
            break;
          }
          case "pong":
            break;
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (closedRef.current) return;
        failuresRef.current += 1;
        if (failuresRef.current >= MAX_WS_FAILURES) {
          setConn("fallback");
          refreshUsage();
          return;
        }
        setConn("connecting");
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** failuresRef.current, 10_000));
      };
      ws.onerror = () => ws.close();
    };

    connect();
    heartbeat = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
        if (Date.now() - lastAliveRef.current > STALE_MS) ws.close(); // 좀비 연결 강제 재접속
      }
    }, HEARTBEAT_MS);

    return () => {
      closedRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeat) clearInterval(heartbeat);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [attemptId, appendDelta, finalizeStream, loadMessages, refreshUsage]);

  // 문제 전환 시 해당 스레드 로드 (+폴백 모드 대비 usage)
  useEffect(() => {
    setMessages([]);
    loadMessages();
    if (conn === "fallback") refreshUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, problemId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // ── 전송 ──────────────────────────────────────────────────
  const send = useCallback(async () => {
    const content = input.trim();
    if (!content || busy || exhausted) return;
    setInput("");
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content, problemId }]);

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const reqId = crypto.randomUUID();
      ws.send(JSON.stringify({ type: "chat", req_id: reqId, problem_id: problemId, content }));
      return; // turn_start/delta/turn_end 봉투가 이후 흐름을 담당
    }

    // SSE 폴백 (WS 불가 환경)
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);
    streamReqRef.current = "sse";
    streamProblemRef.current = problemId;
    streamTextRef.current = "";
    await streamAiChat(
      attemptId,
      { problem_id: problemId, content },
      {
        onDelta: (t) => appendDelta("sse", t),
        onError: (msg) => appendDelta("sse", `\n\n> 오류: ${msg}`),
        onDone: () => {
          finalizeStream();
          refreshUsage();
        },
      },
    );
    finalizeStream();
    refreshUsage();
  }, [attemptId, problemId, input, busy, exhausted, appendDelta, finalizeStream, refreshUsage]);

  const cancel = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "cancel" }));
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* 패널 헤더: 연결 상태 + 모델 + 남은 질문 */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-700 px-4">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-200">
          <span
            title={conn === "online" ? "실시간 연결됨" : conn === "connecting" ? "연결 중" : "호환 모드(SSE)"}
            className={`h-2 w-2 shrink-0 rounded-full ${
              conn === "online" ? "bg-emerald-400" : conn === "connecting" ? "animate-pulse bg-amber-400" : "bg-slate-500"
            }`}
          />
          <span className="truncate">
            AI 어시스턴트
            {usage?.model && <span className="ml-2 font-normal text-slate-500">{usage.model}</span>}
          </span>
        </span>
        {usage?.enabled && (
          <span
            className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              exhausted
                ? "bg-red-500/20 text-red-300"
                : usage.remaining <= Math.max(3, usage.max * 0.15)
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-slate-700 text-slate-300"
            }`}
          >
            남은 질문 {usage.remaining}/{usage.max}
          </span>
        )}
      </div>

      {configured === false ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-400">
          AI가 아직 설정되지 않았습니다.
          <br />
          시험 관리자에게 문의하세요.
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="dark-scroll flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="pt-10 text-center text-sm text-slate-500">
                AI 어시스턴트에게 자유롭게 질문하세요.
                <br />
                <span className="text-xs text-slate-600">
                  모든 대화가 기록되며 평가에 반영됩니다.
                  {usage?.enabled && ` 질문 한도 ${usage.max}회.`}
                </span>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ml-8 rounded-xl bg-violet-600/90 px-4 py-2.5 text-sm text-white">
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              ) : (
                <div key={i} className="mr-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm text-slate-100">
                  {m.content ? (
                    <Markdown dark>{m.content}</Markdown>
                  ) : (
                    <span className="text-slate-400">{m.streaming ? "생각 중..." : ""}</span>
                  )}
                  {m.streaming && m.content && <span className="animate-pulse text-violet-400">▍</span>}
                </div>
              ),
            )}
          </div>
          <div className="border-t border-slate-700 p-3">
            {exhausted && (
              <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
                질문 한도({usage?.max}회)를 모두 사용했습니다. 지금까지의 대화를 참고해 코드를 완성하세요.
              </p>
            )}
            <div className="flex gap-2">
              <textarea
                className="dark-scroll max-h-32 min-h-[44px] flex-1 resize-none rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none disabled:opacity-50"
                placeholder={exhausted ? "질문 한도를 모두 사용했습니다" : "질문 입력... (Ctrl+Enter 전송)"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={exhausted}
              />
              {busy && conn === "online" ? (
                <button
                  onClick={cancel}
                  className="shrink-0 self-end whitespace-nowrap rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800"
                >
                  중단
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={busy || !input.trim() || exhausted}
                  className="shrink-0 self-end whitespace-nowrap rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
                >
                  {busy ? "..." : "전송"}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

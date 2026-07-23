"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamAiChat } from "@/lib/api";
import type { AiMessage, AiUsage } from "@/lib/types";
import { Markdown } from "./Markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

/** AI 활용 테스트의 채팅 패널. 문제별 스레드, 응시당 질문 한도, 모든 턴 서버 기록. */
export function AiChat({ attemptId, problemId }: { attemptId: string; problemId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // usage가 시험별 공급자 오버라이드까지 반영한 configured/model을 함께 내려준다
  const configured = usage === null ? null : usage.configured !== false;

  const refreshUsage = useCallback(() => {
    api.get<AiUsage>(`/attempts/${attemptId}/ai/usage`).then(setUsage).catch(() => {});
  }, [attemptId]);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  useEffect(() => {
    setMessages([]);
    api
      .get<AiMessage[]>(`/attempts/${attemptId}/ai/messages?problem_id=${problemId}`)
      .then((rows) => setMessages(rows.map((m) => ({ role: m.role, content: m.content }))))
      .catch(() => {});
  }, [attemptId, problemId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const exhausted = usage !== null && usage.remaining <= 0;

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content || busy || exhausted) return;
    setInput("");
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content },
      { role: "assistant", content: "", streaming: true },
    ]);

    const append = (delta: string) =>
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, content: last.content + delta };
        return next;
      });

    await streamAiChat(
      attemptId,
      { problem_id: problemId, content },
      {
        onDelta: append,
        onError: (msg) => append(`\n\n> 오류: ${msg}`),
        onDone: () => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.streaming) next[next.length - 1] = { ...last, streaming: false };
            return next;
          });
          setBusy(false);
          refreshUsage();
        },
      },
    );
    setBusy(false);
    refreshUsage();
  }, [attemptId, problemId, input, busy, exhausted, refreshUsage]);

  return (
    <div className="flex h-full flex-col">
      {/* 패널 헤더: 남은 질문 한도 */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-700 px-4">
        <span className="min-w-0 truncate text-sm font-semibold text-slate-200">
          AI 어시스턴트
          {usage?.model && <span className="ml-2 font-normal text-slate-500">{usage.model}</span>}
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
              <button
                onClick={send}
                disabled={busy || !input.trim() || exhausted}
                className="shrink-0 self-end rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
              >
                {busy ? "..." : "전송"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamAiChat } from "@/lib/api";
import type { AiMessage } from "@/lib/types";
import { Markdown } from "./Markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

/** AI 활용 테스트의 채팅 패널. 문제별 스레드, 모든 턴은 서버에 기록된다. */
export function AiChat({ attemptId, problemId }: { attemptId: string; problemId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ configured: boolean }>("/ai/status").then((s) => setConfigured(s.configured));
  }, []);

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

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content || busy) return;
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
        onError: (msg) => append(`\n\n> ⚠️ 오류: ${msg}`),
        onDone: () => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.streaming) next[next.length - 1] = { ...last, streaming: false };
            return next;
          });
          setBusy(false);
        },
      },
    );
    setBusy(false);
  }, [attemptId, problemId, input, busy]);

  if (configured === false) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-400">
        AI가 아직 설정되지 않았습니다.
        <br />
        관리자에게 문의하세요. (AI_API_KEY)
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="dark-scroll flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="pt-10 text-center text-sm text-slate-500">
            AI 어시스턴트에게 자유롭게 질문하세요.
            <br />
            <span className="text-xs text-slate-600">모든 대화는 평가 목적으로 기록됩니다.</span>
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
        <div className="flex gap-2">
          <textarea
            className="dark-scroll max-h-32 min-h-[44px] flex-1 resize-none rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none"
            placeholder="질문 입력... (Ctrl+Enter 전송)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy && configured !== null}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="shrink-0 self-end rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
          >
            {busy ? "..." : "전송"}
          </button>
        </div>
      </div>
    </div>
  );
}

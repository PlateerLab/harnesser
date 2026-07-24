"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AiProviderRow } from "@/lib/types";
import { Markdown } from "../Markdown";

interface ChatItem {
  kind: "user" | "assistant" | "tool" | "error";
  content: string;
}

export interface AuthoringContext {
  active_tab: string;
  tab_context: string;
}

/** 문제 작성 LLM 패널 — 도구 호출을 받아 좌측 초안 패널에 적용한다. */
export function AuthoringChat({
  getContext,
  applyTool,
}: {
  getContext: () => AuthoringContext;
  applyTool: (name: string, input: Record<string, unknown>) => string;
}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [providers, setProviders] = useState<AiProviderRow[]>([]);
  const [providerId, setProviderId] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);
  const failuresRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const applyToolRef = useRef(applyTool);
  applyToolRef.current = applyTool;
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;

  useEffect(() => {
    api.get<AiProviderRow[]>("/admin/settings/ai/providers").then((rows) => {
      const enabled = rows.filter((r) => r.enabled);
      setProviders(enabled);
      const def = enabled.find((r) => r.is_chat_default) ?? enabled[0];
      if (def) setProviderId(def.id);
    });
  }, []);

  useEffect(() => {
    closedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closedRef.current || failuresRef.current >= 4) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/authoring/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        failuresRef.current = 0;
        setConnected(true);
      };
      ws.onmessage = (raw) => {
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(String(raw.data));
        } catch {
          return;
        }
        switch (ev.type) {
          case "assistant_text":
            setItems((prev) => [...prev, { kind: "assistant", content: ev.text as string }]);
            break;
          case "tool_call": {
            const name = ev.name as string;
            const toolInput = (ev.input ?? {}) as Record<string, unknown>;
            let result: string;
            try {
              result = applyToolRef.current(name, toolInput);
            } catch (e) {
              result = `실패 — ${e instanceof Error ? e.message : String(e)}`;
            }
            ws.send(JSON.stringify({ type: "tool_result", call_id: ev.call_id, result }));
            if (name !== "get_draft") {
              setItems((prev) => [...prev, { kind: "tool", content: result }]);
            }
            break;
          }
          case "turn_end":
            if (ev.error) setItems((prev) => [...prev, { kind: "error", content: String(ev.error) }]);
            setBusy(false);
            break;
          case "error":
            setItems((prev) => [...prev, { kind: "error", content: String(ev.message) }]);
            setBusy(false);
            break;
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        setBusy(false);
        if (!closedRef.current) {
          failuresRef.current += 1;
          timer = setTimeout(connect, Math.min(1000 * 2 ** failuresRef.current, 8000));
        }
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      closedRef.current = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, busy]);

  const send = useCallback(() => {
    const content = input.trim();
    const ws = wsRef.current;
    if (!content || busy || !ws || ws.readyState !== WebSocket.OPEN) return;
    const ctx = getContextRef.current();
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setBusy(true);
    setItems((prev) => [...prev, { kind: "user", content }]);
    ws.send(
      JSON.stringify({
        type: "chat",
        req_id: crypto.randomUUID(),
        content,
        provider_id: providerId,
        active_tab: ctx.active_tab,
        tab_context: ctx.tab_context,
      }),
    );
  }, [input, busy, providerId]);

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-slate-900 text-slate-100">
      {/* 헤더: 연결 상태 + 공급자 선택 */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-700 px-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`}
          />
          <span className="truncate">작성 도우미</span>
        </span>
        <select
          className="max-w-[55%] shrink-0 truncate rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          disabled={busy}
        >
          {providers.length === 0 && <option value="">공급자 없음 (설정에서 등록)</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.model}
            </option>
          ))}
        </select>
      </div>

      {/* 대화 */}
      <div ref={scrollRef} className="dark-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {items.length === 0 && (
          <div className="pt-8 text-center text-sm text-slate-500">
            문제 작성을 도와드립니다. 예:
            <br />
            <span className="text-xs text-slate-600">
              “이분 탐색 medium 문제를 만들어줘” · “지문의 제한 조건을 더 엄밀하게” · “경계값 테스트 추가해줘”
            </span>
            <br />
            <span className="mt-2 block text-xs text-slate-600">기본적으로 현재 열린 탭을 대상으로 작업합니다.</span>
          </div>
        )}
        {items.map((m, i) =>
          m.kind === "user" ? (
            <div key={i} className="ml-8 rounded-xl bg-violet-600/90 px-3.5 py-2 text-sm text-white">
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ) : m.kind === "assistant" ? (
            <div key={i} className="mr-2 rounded-xl bg-slate-800 px-3.5 py-2 text-sm">
              <Markdown dark>{m.content}</Markdown>
            </div>
          ) : m.kind === "tool" ? (
            <div key={i} className="flex justify-center">
              <span className="max-w-full truncate rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-400">
                {m.content}
              </span>
            </div>
          ) : (
            <div key={i} className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {m.content}
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 px-1 text-xs text-slate-500">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-slate-300" />
            작성 중...
          </div>
        )}
      </div>

      {/* 통합 채팅바 */}
      <div className="p-3 pt-1">
        <div className="rounded-2xl border border-slate-600 bg-slate-800 transition-colors focus-within:border-violet-500/70">
          <textarea
            ref={inputRef}
            rows={1}
            className="dark-scroll block max-h-36 w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm text-slate-100 placeholder-slate-500 outline-none"
            placeholder="무엇을 만들까요?"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex items-center justify-between px-2 pb-2 pl-4">
            <span className="select-none text-[11px] text-slate-600">Enter 전송 · Shift+Enter 줄바꿈</span>
            <button
              onClick={send}
              disabled={busy || !input.trim() || !connected}
              title="전송 (Enter)"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${
                busy || !input.trim() || !connected
                  ? "cursor-not-allowed bg-slate-700 text-slate-500"
                  : "bg-violet-500 text-white hover:bg-violet-400"
              }`}
            >
              {busy ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-slate-200" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

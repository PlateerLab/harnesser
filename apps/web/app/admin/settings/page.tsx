"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AiSettings, AiTestResult } from "@/lib/types";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { Button, Card, Field, inputCls, Spinner } from "@/components/ui";

const PRESETS = [
  { label: "OpenAI", base_url: "https://api.openai.com/v1", chat_model: "gpt-4o-mini" },
  { label: "Anthropic", base_url: "https://api.anthropic.com/v1", chat_model: "claude-sonnet-5" },
  { label: "vLLM (사내)", base_url: "http://localhost:8000/v1", chat_model: "" },
];

export default function SettingsPage() {
  const { user, loading } = useUser(["admin"]);
  const [saved, setSaved] = useState<AiSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState(""); // 빈 값이면 기존 유지
  const [clearKey, setClearKey] = useState(false);
  const [chatModel, setChatModel] = useState("");
  const [evalModel, setEvalModel] = useState("");
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [busy, setBusy] = useState<"" | "test" | "save">("");

  const load = () =>
    api.get<AiSettings>("/admin/settings/ai").then((s) => {
      setSaved(s);
      setBaseUrl(s.base_url);
      setChatModel(s.chat_model);
      setEvalModel(s.eval_model);
    });

  useEffect(() => {
    if (user) load();
  }, [user]);

  const body = () => ({
    base_url: baseUrl,
    api_key: clearKey ? "" : apiKey.trim() ? apiKey.trim() : null,
    chat_model: chatModel,
    eval_model: evalModel,
  });

  const test = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      setTestResult(await api.post<AiTestResult>("/admin/settings/ai/test", body()));
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof ApiError ? e.message : "테스트 실패" });
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await api.put("/admin/settings/ai", body());
      setApiKey("");
      setClearKey(false);
      await load();
      alert("저장되었습니다. AI 채팅과 자동평가에 즉시 반영됩니다.");
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "저장 실패");
    } finally {
      setBusy("");
    }
  };

  if (loading || !user) return <Spinner />;

  const eff = saved?.effective;

  return (
    <Shell user={user}>
      <h1 className="mb-2 text-xl font-bold">설정</h1>
      <p className="mb-6 text-sm text-slate-500">
        AI 활용 테스트의 채팅과 LLM 자동평가에 사용할 공급자를 설정합니다. OpenAI 호환 API면 무엇이든 연결할 수
        있습니다 (OpenAI · Anthropic compat · vLLM · 사내 게이트웨이).
      </p>

      {saved && (
        <div
          className={`mb-6 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
            eff?.configured
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <span className="text-lg">{eff?.configured ? "🟢" : "🟡"}</span>
          {eff?.configured ? (
            <span>
              <b>연결 설정됨</b> — {eff.base_url} · 채팅 <b>{eff.chat_model}</b> · 평가 <b>{eff.eval_model}</b>
              <span className="ml-2 rounded bg-white/70 px-1.5 py-0.5 text-xs">
                {eff.source === "db" ? "관리자 설정" : "환경변수(.env)"}
              </span>
            </span>
          ) : (
            <span>
              <b>미설정</b> — AI 채팅과 자동평가가 비활성화되어 있습니다. 아래에서 키를 등록하세요.
            </span>
          )}
        </div>
      )}

      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">LLM 공급자</h2>
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setBaseUrl(p.base_url);
                  if (p.chat_model) setChatModel(p.chat_model);
                }}
                className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <Field label="Base URL" hint="OpenAI 호환 엔드포인트 (예: https://api.openai.com/v1)">
          <input className={inputCls} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </Field>

        <Field
          label="API 키"
          hint={
            saved?.has_key
              ? `현재 저장된 키: ${saved.key_hint} — 비워두면 유지됩니다`
              : "저장 시 서버에만 보관되며 화면에 다시 표시되지 않습니다"
          }
        >
          <div className="flex items-center gap-3">
            <input
              className={inputCls}
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (e.target.value) setClearKey(false);
              }}
              placeholder={saved?.has_key ? "(변경할 때만 입력)" : "sk-..."}
              disabled={clearKey}
            />
            {saved?.has_key && (
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-red-500">
                <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />
                키 삭제
              </label>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="채팅 모델" hint="응시자 AI 채팅에 사용">
            <input className={inputCls} value={chatModel} onChange={(e) => setChatModel(e.target.value)} placeholder="gpt-4o-mini" />
          </Field>
          <Field label="평가 모델" hint="비워두면 채팅 모델을 사용">
            <input className={inputCls} value={evalModel} onChange={(e) => setEvalModel(e.target.value)} placeholder="(채팅 모델과 동일)" />
          </Field>
        </div>

        {testResult && (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              testResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
            }`}
          >
            {testResult.ok ? (
              <span>
                ✅ 연결 성공 — <b>{testResult.model}</b> · {testResult.latency_ms}ms
                {testResult.reply && <span className="ml-2 text-emerald-600">응답: {testResult.reply}</span>}
              </span>
            ) : (
              <span>❌ 연결 실패 — {testResult.error}</span>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={test} disabled={busy !== ""}>
            {busy === "test" ? "테스트 중..." : "🔌 연결 테스트"}
          </Button>
          <Button onClick={save} disabled={busy !== ""}>
            {busy === "save" ? "저장 중..." : "저장"}
          </Button>
        </div>
      </Card>

      <p className="mt-4 text-xs text-slate-400">
        저장된 키는 DB에 보관되며 환경변수(.env)보다 우선합니다. 연결 테스트는 저장 전 입력값으로도 실행됩니다.
      </p>
    </Shell>
  );
}

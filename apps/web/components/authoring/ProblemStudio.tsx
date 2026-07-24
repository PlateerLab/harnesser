"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { LANGUAGES, type Problem, type TestCase } from "@/lib/types";
import { CodeEditor } from "../CodeEditor";
import { Divider } from "../Divider";
import { Markdown } from "../Markdown";
import { Button, Card, Field, inputCls } from "../ui";
import { AuthoringChat } from "./AuthoringChat";

type TabKey = "basic" | "statement" | "starter" | "tests";

const TABS: { key: TabKey; label: string }[] = [
  { key: "basic", label: "기본 정보" },
  { key: "statement", label: "문제" },
  { key: "starter", label: "시작 코드" },
  { key: "tests", label: "테스트 케이스" },
];

const STATEMENT_TEMPLATE = `## 문제

(문제 상황과 요구사항을 설명하세요.)

## 입력

첫째 줄에 …가 주어집니다.

## 출력

첫째 줄에 …를 출력합니다.

## 제한

- 1 ≤ N ≤ 100,000
- (값의 범위, 시간 복잡도 힌트 등을 명시하세요.)

## 예시 설명

- 예시 1: …
`;

const STARTER_TEMPLATE: Record<string, string> = {
  python: `import sys
input = sys.stdin.readline


def solve() -> None:
    # TODO: 입력을 읽고 풀이를 작성하세요
    pass


if __name__ == "__main__":
    solve()
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    // TODO: 입력을 읽고 풀이를 작성하세요

    return 0;
}
`,
  java: `import java.io.*;
import java.util.*;

// 클래스 이름은 반드시 Main이어야 합니다.
public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        // TODO: 입력을 읽고 풀이를 작성하세요
    }
}
`,
  go: `package main

import (
	"bufio"
	"fmt"
	"os"
)

var reader = bufio.NewReader(os.Stdin)
var writer = bufio.NewWriter(os.Stdout)

func main() {
	defer writer.Flush()

	// TODO: 입력을 읽고 풀이를 작성하세요
	_ = reader
	_ = fmt.Sprint
}
`,
};

type Draft = Omit<Problem, "id" | "created_at" | "updated_at">;

const EMPTY: Draft = {
  title: "",
  statement_md: STATEMENT_TEMPLATE,
  difficulty: "medium",
  time_limit_ms: 2000,
  memory_limit_mb: 256,
  starter_code: { ...STARTER_TEMPLATE },
  test_cases: [
    { input: "", expected_output: "", is_sample: true, weight: 1 },
    { input: "", expected_output: "", is_sample: false, weight: 2 },
  ],
};

/** 문제 스튜디오 — 좌: 탭 초안 패널 / 우: 도구 연동 LLM 패널 */
export function ProblemStudio({ initial, problemId }: { initial?: Problem; problemId?: string }) {
  const [form, setForm] = useState<Draft>(initial ?? EMPTY);
  const [tab, setTab] = useState<TabKey>("basic");
  const [starterLang, setStarterLang] = useState(LANGUAGES[0].id);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chatW, setChatW] = useState(420);
  const mainRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("harnesser:studio-chat-w"));
      if (isFinite(saved) && saved >= 320 && saved <= 720) setChatW(saved);
    } catch {
      /* 기본값 유지 */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("harnesser:studio-chat-w", String(chatW));
    } catch {
      /* 무시 */
    }
  }, [chatW]);

  const onChatResize = (clientX: number) => {
    const r = mainRef.current?.getBoundingClientRect();
    if (!r) return;
    setChatW(Math.min(720, Math.max(320, r.right - clientX)));
  };

  // 도구 콜백은 렌더 사이클과 무관하게 항상 최신 상태를 봐야 한다
  const formRef = useRef(form);
  formRef.current = form;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const starterLangRef = useRef(starterLang);
  starterLangRef.current = starterLang;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setForm((f) => ({ ...f, [key]: value }));

  const setTc = (idx: number, patch: Partial<TestCase>) =>
    set(
      "test_cases",
      form.test_cases.map((tc, i) => (i === idx ? { ...tc, ...patch } : tc)),
    );

  // ── LLM 도구 실행 (초안만 조작 — 저장은 항상 사람이) ────────────
  const applyTool = (name: string, input: Record<string, unknown>): string => {
    const f = formRef.current;
    switch (name) {
      case "get_draft":
        return JSON.stringify({
          active_tab: tabRef.current,
          basic: {
            title: f.title,
            difficulty: f.difficulty,
            time_limit_ms: f.time_limit_ms,
            memory_limit_mb: f.memory_limit_mb,
          },
          statement_md: f.statement_md,
          starter_code: f.starter_code,
          test_cases: f.test_cases,
        });
      case "update_basic_info": {
        const patch: Partial<Draft> = {};
        if (typeof input.title === "string") patch.title = input.title;
        if (typeof input.difficulty === "string") patch.difficulty = input.difficulty as Draft["difficulty"];
        if (typeof input.time_limit_ms === "number") patch.time_limit_ms = input.time_limit_ms;
        if (typeof input.memory_limit_mb === "number") patch.memory_limit_mb = input.memory_limit_mb;
        if (Object.keys(patch).length === 0) return "변경할 필드가 없습니다";
        setForm((prev) => ({ ...prev, ...patch }));
        setTab("basic");
        return `기본 정보 수정 완료: ${Object.keys(patch).join(", ")}`;
      }
      case "update_statement": {
        const md = String(input.statement_md ?? "");
        setForm((prev) => ({ ...prev, statement_md: md }));
        setTab("statement");
        setPreview(true);
        return `지문 교체 완료 (${md.length}자)`;
      }
      case "update_starter_code": {
        const lang = String(input.language);
        const code = String(input.code ?? "");
        setForm((prev) => ({ ...prev, starter_code: { ...prev.starter_code, [lang]: code } }));
        setTab("starter");
        setStarterLang(lang as (typeof LANGUAGES)[number]["id"]);
        return `${lang} 시작 코드 교체 완료 (${code.length}자)`;
      }
      case "set_test_cases": {
        const tcs = (input.test_cases as TestCase[]) ?? [];
        setForm((prev) => ({ ...prev, test_cases: tcs }));
        setTab("tests");
        const samples = tcs.filter((t) => t.is_sample).length;
        return `테스트 케이스 ${tcs.length}개로 교체 완료 (공개 ${samples} / 비공개 ${tcs.length - samples})`;
      }
      case "add_test_case": {
        const tc = input as unknown as TestCase;
        setForm((prev) => ({ ...prev, test_cases: [...prev.test_cases, tc] }));
        setTab("tests");
        return `테스트 케이스 추가 완료 (총 ${f.test_cases.length + 1}개)`;
      }
      case "open_tab": {
        const target = String(input.tab) as TabKey;
        setTab(target);
        return "전환 완료";
      }
      default:
        return `알 수 없는 도구: ${name}`;
    }
  };

  // 매 턴 LLM에 제공되는 '열린 탭' 컨텍스트 (환경 제공 — 프롬프트 아님)
  const getContext = () => {
    const f = formRef.current;
    const t = tabRef.current;
    let context = "";
    if (t === "basic") {
      context = JSON.stringify({
        title: f.title,
        difficulty: f.difficulty,
        time_limit_ms: f.time_limit_ms,
        memory_limit_mb: f.memory_limit_mb,
      });
    } else if (t === "statement") {
      context = f.statement_md;
    } else if (t === "starter") {
      context = `언어: ${starterLangRef.current}\n${f.starter_code[starterLangRef.current] ?? ""}`;
    } else {
      context = JSON.stringify(
        f.test_cases.map((tc, i) => ({
          ordinal: i,
          is_sample: tc.is_sample,
          weight: tc.weight,
          input: tc.input.slice(0, 300),
          expected_output: tc.expected_output.slice(0, 300),
        })),
      );
    }
    return { active_tab: t, tab_context: context.slice(0, 8000) };
  };

  // ── 저장/삭제 ─────────────────────────────────────────────
  const save = async () => {
    if (!form.title.trim()) {
      setTab("basic");
      alert("제목을 입력하세요");
      return;
    }
    setBusy(true);
    try {
      if (problemId) await api.put(`/problems/${problemId}`, form);
      else await api.post("/problems", form);
      router.push("/admin/problems");
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "저장 실패");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!problemId || !confirm("이 문제를 삭제(보관)할까요?")) return;
    await api.del(`/problems/${problemId}`);
    router.push("/admin/problems");
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {/* 상단 고정 헤더 — 저장/삭제 상시 노출 */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/admin/problems"
            className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            ← 문제 목록
          </Link>
          <span className="h-5 w-px shrink-0 bg-slate-200" />
          <span className="shrink-0 whitespace-nowrap text-sm font-bold">
            {problemId ? "문제 편집" : "새 문제"}
          </span>
          {form.title && (
            <span className="min-w-0 truncate text-sm text-slate-400">— {form.title}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {problemId && (
            <button
              onClick={remove}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-red-500 hover:bg-red-50"
            >
              삭제
            </button>
          )}
          <Button variant="secondary" onClick={() => router.push("/admin/problems")}>
            취소
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "저장 중..." : "저장"}
          </Button>
        </div>
      </header>

      {/* 본문: 좌 초안 패널 | 우 에이전트 패널 (항상 표시, 드래그 리사이즈) */}
      <div ref={mainRef} className="flex min-h-0 flex-1">
        <div className="flex min-w-[440px] flex-1 flex-col">
          <div className="flex shrink-0 gap-1 border-b border-slate-200 bg-white px-6">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                {t.label}
                {t.key === "tests" && (
                  <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                    {form.test_cases.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-3xl">
              {tab === "basic" && (
                <Card className="space-y-4 p-6">
                  <Field label="제목">
                    <input
                      className={inputCls}
                      value={form.title}
                      onChange={(e) => set("title", e.target.value)}
                      placeholder="예: 가장 긴 증가하는 부분 수열"
                    />
                  </Field>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <Field label="난이도">
                      <select
                        className={inputCls}
                        value={form.difficulty}
                        onChange={(e) => set("difficulty", e.target.value as Draft["difficulty"])}
                      >
                        <option value="easy">쉬움</option>
                        <option value="medium">보통</option>
                        <option value="hard">어려움</option>
                      </select>
                    </Field>
                    <Field label="시간 제한 (ms)" hint="언어별 보정 계수가 곱해집니다">
                      <input
                        className={inputCls}
                        type="number"
                        value={form.time_limit_ms}
                        onChange={(e) => set("time_limit_ms", Number(e.target.value))}
                      />
                    </Field>
                    <Field label="메모리 제한 (MB)">
                      <input
                        className={inputCls}
                        type="number"
                        value={form.memory_limit_mb}
                        onChange={(e) => set("memory_limit_mb", Number(e.target.value))}
                      />
                    </Field>
                  </div>
                </Card>
              )}

              {tab === "statement" && (
                <Card className="p-6">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">지문 (Markdown)</span>
                    <button
                      className="text-xs font-medium text-violet-600 hover:underline"
                      onClick={() => setPreview((v) => !v)}
                    >
                      {preview ? "편집" : "미리보기"}
                    </button>
                  </div>
                  {preview ? (
                    <div className="min-h-[460px] rounded-lg border border-slate-200 p-5">
                      <Markdown>{form.statement_md}</Markdown>
                    </div>
                  ) : (
                    <textarea
                      className={`${inputCls} min-h-[460px] font-mono text-[13px] leading-relaxed`}
                      value={form.statement_md}
                      onChange={(e) => set("statement_md", e.target.value)}
                    />
                  )}
                </Card>
              )}

              {tab === "starter" && (
                <Card className="p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">언어별 시작 코드 (선택)</span>
                    <div className="flex gap-1">
                      {LANGUAGES.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => setStarterLang(l.id)}
                          className={`whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium ${
                            starterLang === l.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-[460px] overflow-hidden rounded-lg border border-slate-200">
                    <CodeEditor
                      language={starterLang}
                      value={form.starter_code[starterLang] ?? ""}
                      onChange={(code) => set("starter_code", { ...form.starter_code, [starterLang]: code })}
                      theme="light"
                    />
                  </div>
                </Card>
              )}

              {tab === "tests" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">
                      공개 예시는 응시자에게 보이고, 비공개는 채점에만 사용됩니다.
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        set("test_cases", [
                          ...form.test_cases,
                          { input: "", expected_output: "", is_sample: false, weight: 1 },
                        ])
                      }
                    >
                      + 추가
                    </Button>
                  </div>
                  {form.test_cases.map((tc, i) => (
                    <Card key={i} className="p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-4 text-sm">
                          <span className="font-semibold">#{i + 1}</span>
                          <label className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={tc.is_sample}
                              onChange={(e) => setTc(i, { is_sample: e.target.checked })}
                            />
                            예시 공개
                          </label>
                          <label className="flex items-center gap-1.5">
                            가중치
                            <input
                              className="w-16 rounded border border-slate-300 px-2 py-0.5"
                              type="number"
                              min={1}
                              value={tc.weight}
                              onChange={(e) => setTc(i, { weight: Number(e.target.value) })}
                            />
                          </label>
                        </div>
                        <button
                          className="text-xs text-red-500 hover:underline"
                          onClick={() => set("test_cases", form.test_cases.filter((_, j) => j !== i))}
                        >
                          삭제
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="입력">
                          <textarea
                            className={`${inputCls} min-h-20 font-mono text-xs`}
                            value={tc.input}
                            onChange={(e) => setTc(i, { input: e.target.value })}
                          />
                        </Field>
                        <Field label="기대 출력">
                          <textarea
                            className={`${inputCls} min-h-20 font-mono text-xs`}
                            value={tc.expected_output}
                            onChange={(e) => setTc(i, { expected_output: e.target.value })}
                          />
                        </Field>
                      </div>
                    </Card>
                  ))}
                  {form.test_cases.length === 0 && (
                    <Card>
                      <p className="py-8 text-center text-sm text-slate-400">테스트 케이스를 추가하세요.</p>
                    </Card>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <Divider orientation="vertical" onMove={onChatResize} />

        <div style={{ width: chatW }} className="min-w-[320px] shrink-0">
          <AuthoringChat getContext={getContext} applyTool={applyTool} />
        </div>
      </div>
    </div>
  );
}

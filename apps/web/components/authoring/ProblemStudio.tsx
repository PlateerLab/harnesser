"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  LANGUAGES,
  type CriterionItem,
  type Problem,
  type ReferenceFile,
  type ReferenceKind,
  type TestCase,
} from "@/lib/types";
import { CodeEditor } from "../CodeEditor";
import { Divider } from "../Divider";
import { Markdown } from "../Markdown";
import { Button, Card, Field, inputCls } from "../ui";
import { useToast } from "../toast";
import { Explorer } from "../reference/Explorer";
import { Viewer } from "../reference/Viewer";
import { AuthoringChat } from "./AuthoringChat";

type TabKey = "basic" | "statement" | "reference" | "grading" | "starter" | "tests";

const TABS: { key: TabKey; label: string }[] = [
  { key: "basic", label: "기본 정보" },
  { key: "statement", label: "문제" },
  { key: "reference", label: "참고 자료" },
  { key: "grading", label: "채점 기준" },
  { key: "starter", label: "시작 코드" },
  { key: "tests", label: "테스트 케이스" },
];

const DEFAULT_GRADING = {
  process_weight: 50,
  result_weight: 50,
  process: [
    { name: "문제 해결 접근", points: 40, desc: "문제를 정확히 이해하고 적절한 알고리즘·자료구조를 선택했는가" },
    { name: "코드 품질", points: 30, desc: "가독성·구조·네이밍이 우수한가" },
    { name: "AI 활용", points: 30, desc: "(AI 활용 시험) 질문의 질과 검증 태도, 맹목적 복붙 여부" },
  ],
  result: [
    { name: "정답성", points: 70, desc: "테스트 케이스 통과율" },
    { name: "효율성", points: 30, desc: "시간·공간 복잡도" },
  ],
};

const KIND_OPTIONS: { id: ReferenceKind; label: string }[] = [
  { id: "csv", label: "CSV" },
  { id: "markdown", label: "Markdown" },
  { id: "text", label: "텍스트" },
  { id: "json", label: "JSON" },
  { id: "image", label: "이미지" },
];

function detectKind(name: string, type: string): ReferenceKind {
  if (type.startsWith("image/")) return "image";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv") return "csv";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "json") return "json";
  return "text";
}

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
  reference_files: [],
  grading_criteria: DEFAULT_GRADING,
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
  const { toast, confirm } = useToast();
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
      toast("제목을 입력하세요", "info");
      return;
    }
    setBusy(true);
    try {
      if (problemId) await api.put(`/problems/${problemId}`, form);
      else await api.post("/problems", form);
      router.push("/admin/problems");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "저장 실패", "error");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!problemId) return;
    if (!(await confirm({ title: "이 문제를 삭제할까요?", danger: true, confirmLabel: "삭제" }))) return;
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
            <div>
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

              {tab === "reference" && (
                <ReferenceEditor
                  files={form.reference_files}
                  onChange={(files) => set("reference_files", files)}
                />
              )}

              {tab === "grading" && (
                <GradingEditor
                  gc={form.grading_criteria}
                  onChange={(gc) => set("grading_criteria", gc)}
                />
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

/** 참고 자료 편집기 — 좌: 탐색기 + 파일 목록, 우: 선택 파일 편집/미리보기 */
function ReferenceEditor({
  files,
  onChange,
}: {
  files: ReferenceFile[];
  onChange: (files: ReferenceFile[]) => void;
}) {
  const [selected, setSelected] = useState<string | null>(files[0]?.path ?? null);
  const [preview, setPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = files.find((f) => f.path === selected) ?? null;

  const update = (path: string, patch: Partial<ReferenceFile>) => {
    onChange(files.map((f) => (f.path === path ? { ...f, ...patch } : f)));
    if (patch.path && selected === path) setSelected(patch.path);
  };

  const addFile = () => {
    let n = files.length + 1;
    let path = `자료${n}.md`;
    const paths = new Set(files.map((f) => f.path));
    while (paths.has(path)) path = `자료${++n}.md`;
    onChange([...files, { path, kind: "markdown", content: "" }]);
    setSelected(path);
  };

  const removeFile = (path: string) => {
    const next = files.filter((f) => f.path !== path);
    onChange(next);
    if (selected === path) setSelected(next[0]?.path ?? null);
  };

  const onUpload = (fileList: FileList | null) => {
    if (!fileList) return;
    const existing = new Set(files.map((f) => f.path));
    const readers: Promise<ReferenceFile>[] = [];
    for (const file of Array.from(fileList).slice(0, 20)) {
      const kind = detectKind(file.name, file.type);
      let path = file.name;
      let i = 1;
      while (existing.has(path)) path = `${file.name.replace(/(\.[^.]+)?$/, "")}_${i++}${file.name.match(/\.[^.]+$/)?.[0] ?? ""}`;
      existing.add(path);
      readers.push(
        new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve({ path, kind, content: String(r.result ?? "") });
          if (kind === "image") r.readAsDataURL(file);
          else r.readAsText(file);
        }),
      );
    }
    Promise.all(readers).then((added) => {
      onChange([...files, ...added]);
      if (added[0]) setSelected(added[0].path);
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div>
          <span className="text-sm font-bold text-slate-800">참고 자료 ({files.length}개)</span>
          <p className="mt-0.5 text-xs text-slate-400">응시자가 IDE 탐색기처럼 열람합니다. 경로에 “/”를 넣으면 폴더가 됩니다.</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".csv,.md,.markdown,.json,.txt,image/*"
            className="hidden"
            onChange={(e) => onUpload(e.target.files)}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            파일 업로드
          </Button>
          <Button variant="secondary" onClick={addFile}>
            + 새 파일
          </Button>
        </div>
      </div>

      <div className="flex min-h-[460px]">
        {/* 탐색기 */}
        <div className="w-64 shrink-0 border-r border-slate-100 bg-slate-50">
          <Explorer files={files} activePath={selected} onOpen={setSelected} theme="light" />
        </div>

        {/* 편집 */}
        <div className="min-w-0 flex-1 p-5">
          {!current ? (
            <p className="py-16 text-center text-sm text-slate-400">파일을 추가하거나 업로드하세요.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="md:col-span-2">
                  <Field label="경로 / 파일명">
                    <input
                      className={inputCls}
                      value={current.path}
                      onChange={(e) => update(current.path, { path: e.target.value })}
                      placeholder="예: CSV 데이터/인사평가.csv"
                    />
                  </Field>
                </div>
                <Field label="종류">
                  <select
                    className={inputCls}
                    value={current.kind}
                    onChange={(e) => update(current.path, { kind: e.target.value as ReferenceKind })}
                  >
                    {KIND_OPTIONS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {current.kind === "image" ? (
                <div className="rounded-lg border border-slate-200 p-4">
                  {current.content ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={current.content} alt={current.path} className="max-h-80 rounded" />
                  ) : (
                    <p className="text-sm text-slate-400">이미지는 업로드로 추가하세요.</p>
                  )}
                </div>
              ) : (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">내용</span>
                    <button
                      className="text-xs font-medium text-violet-600 hover:underline"
                      onClick={() => setPreview((v) => !v)}
                    >
                      {preview ? "편집" : "미리보기"}
                    </button>
                  </div>
                  {preview ? (
                    <div className="h-80 overflow-hidden rounded-lg border border-slate-200">
                      <Viewer file={current} theme="light" />
                    </div>
                  ) : (
                    <textarea
                      className={`${inputCls} h-80 font-mono text-xs`}
                      value={current.content}
                      onChange={(e) => update(current.path, { content: e.target.value })}
                      placeholder={current.kind === "csv" ? "헤더,열2\n값1,값2" : "내용을 입력하세요"}
                    />
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  className="text-xs text-red-500 hover:underline"
                  onClick={() => removeFile(current.path)}
                >
                  이 파일 삭제
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** 채점 기준 편집기 — 과정/결과 가중치 + 세부 항목 */
function GradingEditor({
  gc,
  onChange,
}: {
  gc: Problem["grading_criteria"];
  onChange: (gc: Problem["grading_criteria"]) => void;
}) {
  const process = gc.process ?? [];
  const result = gc.result ?? [];

  const editItems = (key: "process" | "result", items: CriterionItem[]) => onChange({ ...gc, [key]: items });

  const section = (
    title: string,
    weightKey: "process_weight" | "result_weight",
    listKey: "process" | "result",
    items: CriterionItem[],
  ) => (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-800">{title}</span>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          가중치
          <input
            className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            type="number"
            min={0}
            max={100}
            value={gc[weightKey] ?? 50}
            onChange={(e) => onChange({ ...gc, [weightKey]: Number(e.target.value) })}
          />
          %
        </label>
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm font-medium"
                value={it.name}
                onChange={(e) => editItems(listKey, items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                placeholder="평가 항목"
              />
              <input
                className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                type="number"
                min={0}
                value={it.points}
                onChange={(e) => editItems(listKey, items.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))}
              />
              <span className="text-xs text-slate-400">점</span>
              <button
                className="rounded p-1 text-slate-400 hover:text-red-500"
                onClick={() => editItems(listKey, items.filter((_, j) => j !== i))}
                aria-label="삭제"
              >
                ✕
              </button>
            </div>
            <input
              className="mt-2 w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-600"
              value={it.desc ?? ""}
              onChange={(e) => editItems(listKey, items.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))}
              placeholder="설명 (선택)"
            />
          </div>
        ))}
        <button
          onClick={() => editItems(listKey, [...items, { name: "", points: 0, desc: "" }])}
          className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700"
        >
          + 항목 추가
        </button>
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        채점 기준은 응시자에게 그대로 노출되며, LLM 자동평가의 기준으로도 사용됩니다. 과정 + 결과 가중치는 합이
        100%가 되도록 맞추는 것을 권장합니다.
      </p>
      {section("과정 평가", "process_weight", "process", process)}
      {section("결과 평가", "result_weight", "result", result)}
    </div>
  );
}

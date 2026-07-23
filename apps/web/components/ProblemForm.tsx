"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { LANGUAGES, type Problem, type TestCase } from "@/lib/types";
import { CodeEditor } from "./CodeEditor";
import { Markdown } from "./Markdown";
import { Button, Card, Field, inputCls } from "./ui";

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

const EMPTY: Omit<Problem, "id" | "created_at" | "updated_at"> = {
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

export function ProblemForm({ initial, problemId }: { initial?: Problem; problemId?: string }) {
  const [form, setForm] = useState(initial ?? EMPTY);
  const [starterLang, setStarterLang] = useState(LANGUAGES[0].id);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setTc = (idx: number, patch: Partial<TestCase>) =>
    set(
      "test_cases",
      form.test_cases.map((tc, i) => (i === idx ? { ...tc, ...patch } : tc)),
    );

  const save = async () => {
    if (!form.title.trim()) {
      alert("제목을 입력하세요");
      return;
    }
    setBusy(true);
    try {
      if (problemId) {
        await api.put(`/problems/${problemId}`, form);
      } else {
        await api.post("/problems", form);
      }
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
    <div className="space-y-6">
      <Card className="space-y-4 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <Field label="제목">
              <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} />
            </Field>
          </div>
          <Field label="난이도">
            <select
              className={inputCls}
              value={form.difficulty}
              onChange={(e) => set("difficulty", e.target.value as typeof form.difficulty)}
            >
              <option value="easy">쉬움</option>
              <option value="medium">보통</option>
              <option value="hard">어려움</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="시간(ms)">
              <input
                className={inputCls}
                type="number"
                value={form.time_limit_ms}
                onChange={(e) => set("time_limit_ms", Number(e.target.value))}
              />
            </Field>
            <Field label="메모리(MB)">
              <input
                className={inputCls}
                type="number"
                value={form.memory_limit_mb}
                onChange={(e) => set("memory_limit_mb", Number(e.target.value))}
              />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">지문 (Markdown)</span>
            <button className="text-xs text-violet-600 hover:underline" onClick={() => setPreview((v) => !v)}>
              {preview ? "편집" : "미리보기"}
            </button>
          </div>
          {preview ? (
            <div className="min-h-48 rounded-lg border border-slate-200 p-4">
              <Markdown>{form.statement_md}</Markdown>
            </div>
          ) : (
            <textarea
              className={`${inputCls} min-h-48 font-mono`}
              value={form.statement_md}
              onChange={(e) => set("statement_md", e.target.value)}
            />
          )}
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">시작 코드 (선택)</h2>
          <div className="flex gap-1">
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                onClick={() => setStarterLang(l.id)}
                className={`rounded-lg px-3 py-1 text-xs font-medium ${
                  starterLang === l.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-56 overflow-hidden rounded-lg border border-slate-200">
          <CodeEditor
            language={starterLang}
            value={form.starter_code[starterLang] ?? ""}
            onChange={(code) => set("starter_code", { ...form.starter_code, [starterLang]: code })}
            theme="light"
          />
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">테스트 케이스</h2>
          <Button
            variant="secondary"
            onClick={() =>
              set("test_cases", [
                ...form.test_cases,
                { input: "", expected_output: "", is_sample: form.test_cases.length < 2, weight: 1 },
              ])
            }
          >
            + 추가
          </Button>
        </div>
        <div className="space-y-4">
          {form.test_cases.map((tc, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-4">
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
            </div>
          ))}
          {form.test_cases.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">테스트 케이스를 추가하세요.</p>
          )}
        </div>
      </Card>

      <div className="flex justify-between">
        {problemId ? (
          <Button variant="danger" onClick={remove}>
            문제 삭제
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push("/admin/problems")}>
            취소
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "저장 중..." : "저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}

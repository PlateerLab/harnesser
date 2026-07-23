"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { AiProviderRow, Assessment, ProblemSummary, User } from "@/lib/types";
import { DIFFICULTY_LABEL } from "@/lib/format";
import { Badge, Button, Card, Field, inputCls } from "./ui";

interface FormState {
  title: string;
  description: string;
  mode: "standard" | "ai_assisted";
  duration_min: number;
  ai_max_turns: number;
  ai_provider_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  problems: { problem_id: string; points: number }[];
  assignee_ids: string[];
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AssessmentForm({ initial, assessmentId }: { initial?: Assessment; assessmentId?: string }) {
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          title: initial.title,
          description: initial.description,
          mode: initial.mode,
          duration_min: initial.duration_min,
          ai_max_turns: initial.ai_max_turns ?? 20,
          ai_provider_id: initial.ai_provider_id ?? null,
          starts_at: initial.starts_at,
          ends_at: initial.ends_at,
          problems: initial.problems.map((p) => ({ problem_id: p.problem_id, points: p.points })),
          assignee_ids: initial.assignments.map((a) => a.user_id),
        }
      : {
          title: "",
          description: "",
          mode: "standard",
          duration_min: 90,
          ai_max_turns: 20,
          ai_provider_id: null,
          starts_at: null,
          ends_at: null,
          problems: [],
          assignee_ids: [],
        },
  );
  const [allProblems, setAllProblems] = useState<ProblemSummary[]>([]);
  const [candidates, setCandidates] = useState<User[]>([]);
  const [providers, setProviders] = useState<AiProviderRow[]>([]);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    api.get<ProblemSummary[]>("/problems").then(setAllProblems);
    api.get<User[]>("/admin/users?role=candidate").then(setCandidates);
    api.get<AiProviderRow[]>("/admin/settings/ai/providers").then(setProviders).catch(() => {});
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleProblem = (id: string) => {
    const exists = form.problems.some((p) => p.problem_id === id);
    set(
      "problems",
      exists
        ? form.problems.filter((p) => p.problem_id !== id)
        : [...form.problems, { problem_id: id, points: 100 }],
    );
  };

  const toggleAssignee = (id: string) => {
    const exists = form.assignee_ids.includes(id);
    set("assignee_ids", exists ? form.assignee_ids.filter((x) => x !== id) : [...form.assignee_ids, id]);
  };

  const save = async () => {
    if (!form.title.trim()) return alert("제목을 입력하세요");
    if (form.problems.length === 0) return alert("문제를 1개 이상 선택하세요");
    setBusy(true);
    const payload = {
      ...form,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    };
    try {
      if (assessmentId) await api.put(`/assessments/${assessmentId}`, payload);
      else await api.post("/assessments", payload);
      router.push("/admin/assessments");
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "저장 실패");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!assessmentId || !confirm("시험을 삭제할까요? 응시 기록도 함께 삭제됩니다.")) return;
    await api.del(`/assessments/${assessmentId}`);
    router.push("/admin/assessments");
  };

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="시험 제목">
            <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="모드">
            <div className="flex gap-2 pt-1">
              {(
                [
                  ["standard", "일반 코딩 테스트"],
                  ["ai_assisted", "AI 활용 테스트"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => set("mode", mode)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    form.mode === mode
                      ? mode === "ai_assisted"
                        ? "bg-violet-600 text-white"
                        : "bg-slate-900 text-white"
                      : "border border-slate-300 text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <Field label="설명">
          <textarea
            className={`${inputCls} min-h-16`}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        {form.mode === "ai_assisted" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="AI 질문 한도 (회)"
              hint="응시 1회당 AI에게 질문할 수 있는 최대 횟수입니다. 한도 도달 시 채팅이 차단됩니다."
            >
              <input
                className={`${inputCls} max-w-40`}
                type="number"
                min={1}
                max={500}
                value={form.ai_max_turns}
                onChange={(e) => set("ai_max_turns", Number(e.target.value))}
              />
            </Field>
            <Field
              label="LLM 공급자"
              hint="이 시험에서 사용할 모델입니다. 미지정 시 설정의 기본 채팅 공급자를 사용합니다."
            >
              <select
                className={inputCls}
                value={form.ai_provider_id ?? ""}
                onChange={(e) => set("ai_provider_id", e.target.value || null)}
              >
                <option value="">기본 공급자 사용</option>
                {providers
                  .filter((p) => p.enabled)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.model}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="제한시간 (분)">
            <input
              className={inputCls}
              type="number"
              min={5}
              value={form.duration_min}
              onChange={(e) => set("duration_min", Number(e.target.value))}
            />
          </Field>
          <Field label="응시 시작 가능 (선택)">
            <input
              className={inputCls}
              type="datetime-local"
              value={toLocalInput(form.starts_at)}
              onChange={(e) => set("starts_at", e.target.value || null)}
            />
          </Field>
          <Field label="응시 마감 (선택)">
            <input
              className={inputCls}
              type="datetime-local"
              value={toLocalInput(form.ends_at)}
              onChange={(e) => set("ends_at", e.target.value || null)}
            />
          </Field>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-3 font-bold">출제 문제 ({form.problems.length}개 선택)</h2>
        <div className="space-y-2">
          {allProblems.map((p) => {
            const selected = form.problems.find((x) => x.problem_id === p.id);
            return (
              <div
                key={p.id}
                className={`flex items-center justify-between rounded-lg border p-3 ${
                  selected ? "border-slate-900 bg-slate-50" : "border-slate-200"
                }`}
              >
                <label className="flex flex-1 cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={!!selected} onChange={() => toggleProblem(p.id)} />
                  <span className="font-medium">{p.title}</span>
                  <Badge value={p.difficulty} label={DIFFICULTY_LABEL[p.difficulty]} />
                </label>
                {selected && (
                  <label className="flex items-center gap-2 text-sm text-slate-500">
                    배점
                    <input
                      className="w-20 rounded border border-slate-300 px-2 py-1"
                      type="number"
                      value={selected.points}
                      onChange={(e) =>
                        set(
                          "problems",
                          form.problems.map((x) =>
                            x.problem_id === p.id ? { ...x, points: Number(e.target.value) } : x,
                          ),
                        )
                      }
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-3 font-bold">응시자 배정 ({form.assignee_ids.length}명)</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {candidates.map((c) => (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                form.assignee_ids.includes(c.id) ? "border-slate-900 bg-slate-50" : "border-slate-200"
              }`}
            >
              <input
                type="checkbox"
                checked={form.assignee_ids.includes(c.id)}
                onChange={() => toggleAssignee(c.id)}
              />
              <span className="font-medium">{c.name}</span>
              <span className="text-sm text-slate-400">{c.email}</span>
            </label>
          ))}
          {candidates.length === 0 && (
            <p className="text-sm text-slate-400">응시자 계정이 없습니다. 사용자 메뉴에서 먼저 생성하세요.</p>
          )}
        </div>
      </Card>

      <div className="flex justify-between">
        {assessmentId ? (
          <Button variant="danger" onClick={remove}>
            시험 삭제
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push("/admin/assessments")}>
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

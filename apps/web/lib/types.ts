export type Role = "admin" | "evaluator" | "candidate";
export type Language = "python" | "cpp" | "java" | "go";
export type Mode = "standard" | "ai_assisted";

export const LANGUAGES: { id: Language; label: string; monaco: string }[] = [
  { id: "python", label: "Python 3", monaco: "python" },
  { id: "cpp", label: "C++17", monaco: "cpp" },
  { id: "java", label: "Java 21", monaco: "java" },
  { id: "go", label: "Go", monaco: "go" },
];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface TestCase {
  id?: string;
  input: string;
  expected_output: string;
  is_sample: boolean;
  weight: number;
  ordinal?: number;
}

export interface Problem {
  id: string;
  title: string;
  statement_md: string;
  difficulty: "easy" | "medium" | "hard";
  time_limit_ms: number;
  memory_limit_mb: number;
  starter_code: Record<string, string>;
  test_cases: TestCase[];
  created_at: string;
  updated_at: string;
}

export interface ProblemSummary {
  id: string;
  title: string;
  difficulty: string;
  test_case_count: number;
  created_at: string;
}

export interface AssessmentProblemRef {
  problem_id: string;
  title: string;
  difficulty: string;
  ordinal: number;
  points: number;
}

export interface AssignmentRef {
  user_id: string;
  email: string;
  name: string;
  attempt_id: string | null;
  attempt_status: string | null;
}

export interface Assessment {
  id: string;
  title: string;
  description: string;
  mode: Mode;
  duration_min: number;
  ai_max_turns: number;
  ai_provider_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  problems: AssessmentProblemRef[];
  assignments: AssignmentRef[];
}

export interface AiProviderMeta {
  provider: string;
  label: string;
  kind: "cloud" | "local";
  needs_key: boolean;
  needs_base_url: boolean;
  default_base_url: string | null;
  placeholder_model: string;
  description: string;
}

export interface AiEffective {
  configured: boolean;
  provider: string;
  model: string;
  name: string;
  source: "db" | "env";
}

export interface AiSettingsMeta {
  catalog: AiProviderMeta[];
  effective_chat: AiEffective | null;
  effective_eval: AiEffective | null;
  env_fallback_available: boolean;
}

export interface AiProviderRow {
  id: string;
  name: string;
  provider: string;
  base_url: string | null;
  model: string;
  temperature: number;
  max_tokens: number;
  enabled: boolean;
  is_chat_default: boolean;
  is_eval_default: boolean;
  has_key: boolean;
  key_hint: string | null;
  created_at: string;
}

export interface AiModelInfo {
  id: string;
  display_name: string | null;
}

export interface AiUsage {
  enabled: boolean;
  used: number;
  max: number;
  remaining: number;
  configured?: boolean;
  model?: string | null;
  provider?: string | null;
}

export interface AiTestResult {
  ok: boolean;
  latency_ms?: number;
  model?: string;
  reply?: string;
  error?: string;
}

export interface MyAssignment {
  assessment_id: string;
  title: string;
  description: string;
  mode: Mode;
  duration_min: number;
  starts_at: string | null;
  ends_at: string | null;
  problem_count: number;
  attempt_id: string | null;
  attempt_status: string | null;
  assigned: boolean;
}

export interface AttemptProblem {
  id: string;
  ordinal: number;
  points: number;
  title: string;
  statement_md: string;
  difficulty: string;
  time_limit_ms: number;
  memory_limit_mb: number;
  starter_code: Record<string, string>;
  samples: { input: string; expected_output: string }[];
  saved_language: string | null;
  saved_code: string | null;
  saved_code_by_lang: Record<string, string>;
}

export interface ExecutionSummary {
  id: string;
  problem_id: string;
  kind: "run" | "submit";
  language: string;
  status: string;
  verdict: string | null;
  score: number | null;
  passed: number;
  total: number;
  created_at: string;
}

export interface Attempt {
  id: string;
  assessment_id: string;
  assessment_title: string;
  mode: Mode;
  status: "in_progress" | "submitted" | "expired";
  started_at: string;
  deadline_at: string;
  remaining_seconds: number;
  problems: AttemptProblem[];
}

export interface TestResult {
  test_id: string;
  ordinal: number;
  is_sample: boolean;
  verdict: string;
  time_ms: number | null;
  input: string | null;
  expected_output: string | null;
  stdout: string | null;
  stderr: string | null;
}

export interface Execution {
  id: string;
  problem_id: string;
  kind: "run" | "submit";
  language: string;
  status: "queued" | "running" | "done" | "error";
  verdict: string | null;
  score: number | null;
  compile_output: string | null;
  created_at: string;
  finished_at: string | null;
  results: TestResult[];
  passed: number;
  total: number;
  code?: string | null;
}

export interface AiMessage {
  id: string;
  problem_id: string | null;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  created_at: string;
}

export interface EventRow {
  id: number;
  problem_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Evaluation {
  id: string;
  kind: "auto" | "human";
  evaluator_id: string | null;
  evaluator_name: string | null;
  scores: Record<string, unknown>;
  summary: string;
  created_at: string;
}

export interface ReviewAttemptRow {
  id: string;
  assessment_id: string;
  assessment_title: string;
  mode: Mode;
  candidate_name: string;
  candidate_email: string;
  status: string;
  started_at: string;
  submitted_at: string | null;
  total_score: number | null;
  max_score: number | null;
  event_count: number;
  ai_message_count: number;
  has_auto_eval: boolean;
  is_staff: boolean;
}

export interface ReviewDetail {
  attempt: {
    id: string;
    status: string;
    started_at: string;
    deadline_at: string;
    submitted_at: string | null;
  };
  candidate: { name: string; email: string };
  assessment: { id: string; title: string; mode: Mode; duration_min: number };
  problems: {
    id: string;
    title: string;
    difficulty: string;
    points: number;
    statement_md: string;
    best_score: number | null;
    best_verdict: string | null;
    final_language: string | null;
    final_code: string | null;
    test_cases: {
      id: string;
      ordinal: number;
      is_sample: boolean;
      weight: number;
      input: string;
      expected_output: string;
    }[];
  }[];
  events: EventRow[];
  executions: (Execution & { code: string; results: { test_id: string; verdict: string; time_ms: number | null; stdout: string; stderr: string }[] })[];
  ai_messages: AiMessage[];
  evaluations: Evaluation[];
}

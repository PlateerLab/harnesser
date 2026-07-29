export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 시작 시각 기준 상대 시간 (타임라인용) */
export function fmtOffset(startIso: string, iso: string): string {
  const diff = Math.max(0, (new Date(iso).getTime() - new Date(startIso).getTime()) / 1000);
  return `+${fmtDuration(diff)}`;
}

export const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "쉬움",
  medium: "보통",
  hard: "어려움",
};

export const STATUS_LABEL: Record<string, string> = {
  in_progress: "진행 중",
  submitted: "제출 완료",
  expired: "시간 만료",
};

export const VERDICT_LABEL: Record<string, string> = {
  AC: "정답",
  WA: "오답",
  CE: "컴파일 오류",
  RE: "런타임 오류",
  TLE: "시간 초과",
  IE: "채점 오류",
};

export const EVENT_LABEL: Record<string, string> = {
  attempt_started: "시험 시작",
  attempt_finished: "시험 제출",
  attempt_expired: "시간 만료",
  code_snapshot: "코드 스냅샷",
  paste: "붙여넣기",
  copy: "복사",
  cut: "잘라내기",
  focus_lost: "화면 이탈",
  focus_gained: "화면 복귀",
  tab_hidden: "다른 탭/최소화",
  tab_visible: "탭 복귀",
  window_blur: "다른 창/앱 이동",
  window_focus: "창 복귀",
  pointer_away: "포인터 이탈",
  resize: "창 크기 변경",
  net_offline: "네트워크 끊김",
  net_online: "네트워크 복구",
  page_enter: "페이지 진입",
  page_exit: "페이지 이탈",
  run_requested: "실행",
  submit_requested: "제출",
  run_result: "실행 결과",
  submit_result: "채점 결과",
  ai_message: "AI 대화",
  language_change: "언어 변경",
  reference_open: "참고 자료 열람",
};

/** 이탈성 이벤트 (통계·필터 공용) */
export const AWAY_EVENT_TYPES = ["focus_lost", "tab_hidden", "window_blur"];

export function fmtAwayMs(ms: number): string {
  if (ms < 1000) return "1초 미만";
  return fmtDuration(Math.round(ms / 1000));
}

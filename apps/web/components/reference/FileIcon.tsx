import type { ReferenceFile } from "@/lib/types";

const TONE: Record<ReferenceFile["kind"], string> = {
  csv: "text-emerald-400",
  markdown: "text-sky-400",
  text: "text-slate-400",
  image: "text-pink-400",
  json: "text-amber-400",
};

/** 파일 종류 아이콘 — 탐색기/탭 공용 (색으로 종류 구분) */
export function FileIcon({ kind, size = 14 }: { kind: ReferenceFile["kind"]; size?: number }) {
  const cls = TONE[kind];
  if (kind === "image") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} aria-hidden>
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="5.5" cy="6" r="1.2" fill="currentColor" />
        <path d="M2 12l3.5-3.5 2.5 2.5 3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "csv") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} aria-hidden>
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M1.5 6.5h13M6 2.5v11" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    );
  }
  // 문서(text/markdown/json) — 종이 아이콘
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} aria-hidden>
      <path d="M3.5 1.5h6l3 3v10a.5.5 0 01-.5.5h-8.5a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

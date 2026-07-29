"use client";

import { useMemo } from "react";
import type { ReferenceFile } from "@/lib/types";
import { Markdown } from "../Markdown";

/** 참고 자료 뷰어 — 종류별 렌더 (CSV 표 / Markdown / 텍스트 / 이미지 / JSON). */
export function Viewer({ file, theme = "dark" }: { file: ReferenceFile; theme?: "dark" | "light" }) {
  const dark = theme === "dark";

  if (file.kind === "image") {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={file.content} alt={file.path} className="max-h-full max-w-full rounded-lg" />
      </div>
    );
  }

  if (file.kind === "csv") {
    return <CsvTable content={file.content} dark={dark} />;
  }

  if (file.kind === "markdown") {
    return (
      <div className={`h-full overflow-auto p-6 ${dark ? "bg-slate-900" : "bg-white"}`}>
        <div className="mx-auto max-w-3xl">
          <Markdown dark={dark}>{file.content}</Markdown>
        </div>
      </div>
    );
  }

  // text / json — monospace pre
  return (
    <pre
      className={`h-full overflow-auto p-5 font-mono text-xs leading-relaxed ${
        dark ? "bg-slate-900 text-slate-200" : "bg-white text-slate-800"
      }`}
    >
      {file.content}
    </pre>
  );
}

/** 간단한 CSV 파서 — 따옴표/이스케이프 지원. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

function CsvTable({ content, dark }: { content: string; dark: boolean }) {
  const rows = useMemo(() => parseCsv(content), [content]);
  if (rows.length === 0) {
    return <div className={`p-4 text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>빈 CSV</div>;
  }
  const [header, ...body] = rows;
  return (
    <div className={`h-full overflow-auto ${dark ? "bg-slate-900" : "bg-white"}`}>
      <div className={`px-4 py-2 text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
        {body.length} rows × {header.length} cols
      </div>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0">
          <tr>
            {header.map((h, i) => (
              <th
                key={i}
                className={`whitespace-nowrap border px-3 py-1.5 text-left font-semibold ${
                  dark ? "border-slate-700 bg-slate-800 text-slate-200" : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className={dark ? "hover:bg-slate-800/40" : "hover:bg-slate-50"}>
              {header.map((_, ci) => (
                <td
                  key={ci}
                  className={`whitespace-nowrap border px-3 py-1 ${
                    dark ? "border-slate-800 text-slate-300" : "border-slate-100 text-slate-600"
                  }`}
                >
                  {r[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

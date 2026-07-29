"use client";

import { useMemo, useState } from "react";
import type { ReferenceFile } from "@/lib/types";
import { buildTree, type TreeNode } from "./tree";
import { FileIcon } from "./FileIcon";

/** VSCode 탐색기 스타일 파일 트리 (다크). 파일 클릭 시 onOpen(path). */
export function Explorer({
  files,
  activePath,
  onOpen,
  theme = "dark",
}: {
  files: ReferenceFile[];
  activePath?: string | null;
  onOpen: (path: string) => void;
  theme?: "dark" | "light";
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  if (files.length === 0) {
    return (
      <div className={`p-4 text-center text-xs ${theme === "dark" ? "text-slate-500" : "text-slate-400"}`}>
        참고 자료가 없습니다.
      </div>
    );
  }
  return (
    <div className="py-1 text-sm">
      {tree.map((node) => (
        <Node key={node.path} node={node} depth={0} activePath={activePath} onOpen={onOpen} theme={theme} />
      ))}
    </div>
  );
}

function Node({
  node,
  depth,
  activePath,
  onOpen,
  theme,
}: {
  node: TreeNode;
  depth: number;
  activePath?: string | null;
  onOpen: (path: string) => void;
  theme: "dark" | "light";
}) {
  const [open, setOpen] = useState(true);
  const pad = 8 + depth * 12;
  const dark = theme === "dark";
  const hover = dark ? "hover:bg-slate-800" : "hover:bg-slate-100";

  if (node.type === "folder") {
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ paddingLeft: pad }}
          className={`flex w-full items-center gap-1 py-1 pr-2 text-left ${hover} ${dark ? "text-slate-300" : "text-slate-600"}`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            className={`shrink-0 transition-transform ${open ? "rotate-90" : ""} ${dark ? "text-slate-500" : "text-slate-400"}`}
            fill="none"
            aria-hidden
          >
            <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate text-xs font-medium">{node.name}</span>
        </button>
        {open && node.children.map((c) => (
          <Node key={c.path} node={c} depth={depth + 1} activePath={activePath} onOpen={onOpen} theme={theme} />
        ))}
      </div>
    );
  }

  const active = activePath === node.path;
  return (
    <button
      onClick={() => onOpen(node.path)}
      style={{ paddingLeft: pad + 14 }}
      className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left ${
        active
          ? dark
            ? "bg-slate-700/70 text-white"
            : "bg-slate-200 text-slate-900"
          : `${hover} ${dark ? "text-slate-300" : "text-slate-700"}`
      }`}
    >
      <FileIcon kind={node.kind} />
      <span className="truncate text-xs">{node.name}</span>
    </button>
  );
}

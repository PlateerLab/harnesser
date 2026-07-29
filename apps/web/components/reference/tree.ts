import type { ReferenceFile } from "@/lib/types";

export interface TreeFile {
  type: "file";
  name: string;
  path: string;
  kind: ReferenceFile["kind"];
}
export interface TreeFolder {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}
export type TreeNode = TreeFile | TreeFolder;

/** 경로("폴더/하위/파일.csv") 목록을 VSCode 탐색기용 트리로 변환. 폴더 먼저, 이름순. */
export function buildTree(files: ReferenceFile[]): TreeNode[] {
  const root: TreeFolder = { type: "folder", name: "", path: "", children: [] };

  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLeaf = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      if (isLeaf) {
        cur.children.push({ type: "file", name, path: f.path, kind: f.kind });
      } else {
        let next = cur.children.find(
          (c): c is TreeFolder => c.type === "folder" && c.name === name,
        );
        if (!next) {
          next = { type: "folder", name, path, children: [] };
          cur.children.push(next);
        }
        cur = next;
      }
    }
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.type === "folder") sort(n.children);
  };
  sort(root.children);
  return root.children;
}

export const KIND_LABEL: Record<ReferenceFile["kind"], string> = {
  csv: "CSV",
  markdown: "Markdown",
  text: "텍스트",
  image: "이미지",
  json: "JSON",
};

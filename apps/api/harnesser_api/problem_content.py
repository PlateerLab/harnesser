"""문제의 확장 콘텐츠 — 참고 자료(파일)와 채점 기준의 스키마/기본값.

- 참고 자료: 경로(path) 기반 계층 파일 목록. 기본값 없음(빈 목록).
  kind: csv | markdown | text | image | json  (텍스트류는 content=문자열,
  이미지는 content=data URI).
- 채점 기준: 과정 평가 + 결과 평가 가중치와 세부 항목. 기본값 제공.
"""

import json

REFERENCE_KINDS = ["csv", "markdown", "text", "image", "json"]

# 응시자 AI가 참고 자료를 열람하는 도구 — 접근 경계는 '현재 문제의 참고 자료'로 한정된다.
# 지문/테스트/다른 문제에는 접근할 수 없고, 등록된 파일 경로만 읽을 수 있다.
REFERENCE_READ_CAP = 24_000  # 파일 1회 열람 시 반환 상한

REFERENCE_TOOLS: list[dict] = [
    {
        "name": "list_reference_files",
        "description": "이 문제에 첨부된 참고 자료 파일 목록(경로·종류)을 반환합니다. 내용은 포함하지 않습니다. 어떤 자료가 있는지 먼저 확인할 때 사용하세요.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "read_reference_file",
        "description": "참고 자료 파일 하나의 내용을 읽습니다. path는 list_reference_files가 반환한 정확한 경로여야 합니다. 목록에 없는 파일은 읽을 수 없습니다.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "정확한 파일 경로"}},
            "required": ["path"],
            "additionalProperties": False,
        },
    },
]


def execute_reference_tool(name: str, tool_input: dict, reference_files: list[dict]) -> str:
    """참고 자료 도구 실행 — reference_files 밖의 어떤 것도 노출하지 않는다."""
    index = {f.get("path"): f for f in reference_files}
    if name == "list_reference_files":
        if not reference_files:
            return "이 문제에는 첨부된 참고 자료가 없습니다."
        return json.dumps(
            [{"path": f.get("path"), "kind": f.get("kind")} for f in reference_files],
            ensure_ascii=False,
        )
    if name == "read_reference_file":
        path = str((tool_input or {}).get("path", "")).strip()
        f = index.get(path)
        if not f:
            avail = ", ".join(p for p in index if p) or "없음"
            return (
                f"거부됨 — '{path}'는 접근 가능한 참고 자료가 아닙니다. "
                f"list_reference_files로 목록을 확인한 뒤 정확한 경로로 다시 요청하세요. (접근 가능: {avail})"
            )
        if f.get("kind") == "image":
            return f"[이미지 파일: {path}] 이미지 내용은 텍스트로 제공되지 않습니다. 필요하면 응시자에게 이미지 설명을 요청하세요."
        content = str(f.get("content", ""))
        truncated = "\n\n…(이하 생략)" if len(content) > REFERENCE_READ_CAP else ""
        return content[:REFERENCE_READ_CAP] + truncated
    return f"알 수 없는 도구: {name}"


# 도구를 붙일 수 없는 공급자(예: Claude Code CLI)를 위한 인라인 폴백 —
# 같은 접근 경계(이 문제의 참고 자료뿐)를 유지한 채 내용을 프롬프트에 싣는다.
REFERENCE_INLINE_TOTAL_CAP = 120_000  # 인라인 주입 총량 상한 (문자)


def render_references_inline(reference_files: list[dict]) -> str:
    """참고 자료 전체를 시스템 프롬프트용 텍스트 블록으로 렌더링.

    파일당 REFERENCE_READ_CAP, 전체 REFERENCE_INLINE_TOTAL_CAP으로 제한하고
    이미지는 목록만 남긴다(도구 경로의 read_reference_file과 동일한 규칙).
    """
    if not reference_files:
        return ""
    parts: list[str] = ["[참고 자료 목록]"]
    for f in reference_files:
        parts.append(f"- {f.get('path')} ({f.get('kind')})")
    budget = REFERENCE_INLINE_TOTAL_CAP
    for f in reference_files:
        path, kind = f.get("path"), f.get("kind")
        if kind == "image":
            parts.append(f"\n[참고 자료: {path}]\n(이미지 파일 — 텍스트로 제공되지 않습니다. 필요하면 응시자에게 설명을 요청하세요.)")
            continue
        if budget <= 0:
            parts.append(f"\n[참고 자료: {path}]\n(전체 인라인 한도 초과로 생략)")
            continue
        content = str(f.get("content", ""))[:REFERENCE_READ_CAP]
        if len(content) > budget:
            content = content[:budget] + "\n…(이하 생략)"
        budget -= len(content)
        parts.append(f"\n[참고 자료: {path}]\n{content}")
    return "\n".join(parts)


MAX_REFERENCE_FILES = 40
MAX_TEXT_CONTENT = 400_000  # 텍스트 파일 1개 상한 (약 400KB)
MAX_IMAGE_CONTENT = 3_000_000  # data URI 상한 (약 3MB)

# 채점 기준 기본값 — 과정 50% + 결과 50%. 관리자가 문제별로 수정 가능.
DEFAULT_GRADING_CRITERIA: dict = {
    "process_weight": 50,
    "result_weight": 50,
    "process": [
        {"name": "문제 해결 접근", "points": 40, "desc": "문제를 정확히 이해하고 적절한 알고리즘·자료구조를 선택했는가"},
        {"name": "코드 품질", "points": 30, "desc": "가독성·구조·네이밍이 우수한가"},
        {"name": "AI 활용", "points": 30, "desc": "(AI 활용 시험) 질문의 질과 검증 태도, 맹목적 복붙 여부"},
    ],
    "result": [
        {"name": "정답성", "points": 70, "desc": "테스트 케이스 통과율"},
        {"name": "효율성", "points": 30, "desc": "시간·공간 복잡도"},
    ],
}


def default_grading_criteria() -> dict:
    """깊은 복사본을 반환 (호출자가 변형해도 원본이 오염되지 않도록)."""
    import copy

    return copy.deepcopy(DEFAULT_GRADING_CRITERIA)


def normalize_reference_files(files: list[dict] | None) -> list[dict]:
    """참고 자료 목록을 검증·정규화. 잘못된 항목은 조용히 버린다."""
    if not files:
        return []
    out: list[dict] = []
    seen_paths: set[str] = set()
    for f in files[:MAX_REFERENCE_FILES]:
        if not isinstance(f, dict):
            continue
        path = str(f.get("path", "")).strip().strip("/")
        kind = str(f.get("kind", "text"))
        content = f.get("content", "")
        if not path or kind not in REFERENCE_KINDS or not isinstance(content, str):
            continue
        if path in seen_paths:
            continue
        limit = MAX_IMAGE_CONTENT if kind == "image" else MAX_TEXT_CONTENT
        seen_paths.add(path)
        out.append({"path": path, "kind": kind, "content": content[:limit]})
    return out


def normalize_grading_criteria(gc: dict | None) -> dict:
    """채점 기준 정규화. 비거나 잘못되면 기본값."""
    if not isinstance(gc, dict):
        return default_grading_criteria()

    def _items(raw) -> list[dict]:
        items = []
        for it in raw if isinstance(raw, list) else []:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name", "")).strip()
            if not name:
                continue
            items.append(
                {
                    "name": name[:100],
                    "points": max(0, min(1000, int(it.get("points", 0) or 0))),
                    "desc": str(it.get("desc", ""))[:500],
                }
            )
        return items

    process = _items(gc.get("process"))
    result = _items(gc.get("result"))
    if not process and not result:
        return default_grading_criteria()
    return {
        "process_weight": max(0, min(100, int(gc.get("process_weight", 50) or 0))),
        "result_weight": max(0, min(100, int(gc.get("result_weight", 50) or 0))),
        "process": process,
        "result": result,
    }

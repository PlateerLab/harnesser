"""문제의 확장 콘텐츠 — 참고 자료(파일)와 채점 기준의 스키마/기본값.

- 참고 자료: 경로(path) 기반 계층 파일 목록. 기본값 없음(빈 목록).
  kind: csv | markdown | text | image | json  (텍스트류는 content=문자열,
  이미지는 content=data URI).
- 채점 기준: 과정 평가 + 결과 평가 가중치와 세부 항목. 기본값 제공.
"""

REFERENCE_KINDS = ["csv", "markdown", "text", "image", "json"]

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

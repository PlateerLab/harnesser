"""문제 작성 에이전트 — 도구·환경 우선 설계.

경계:
  * 도구는 브라우저의 문제 '초안'만 조작한다 — DB 저장은 항상 관리자가 버튼으로 확정.
  * 모든 도구 입력은 서버에서 jsonschema로 검증되고, 위반은 모델에 오류로 반환된다.
  * 초안의 진실은 클라이언트에 있다 — 모델은 get_draft로 조회한다(추측 금지).
  * 프롬프트는 규칙 5줄뿐 — 나머지는 도구 스키마와 매 턴 주입되는 '열린 탭' 컨텍스트가 담당한다.
"""

from typing import Any, Awaitable, Callable

import jsonschema

from . import provider as ai_provider

MAX_ITERATIONS = 12
MAX_TOOL_RESULT_CHARS = 12000
MAX_TEXT_CHARS = 65536

SYSTEM_PROMPT = """당신은 Harnesser 코딩 테스트 문제 작성 도우미입니다. 도구로 문제 초안을 직접 편집합니다.

규칙:
- 기본 작업 대상은 현재 열린 탭입니다. 사용자가 명시적으로 요청할 때만 다른 영역을 수정하세요.
- 초안의 최신 상태가 필요하면 get_draft를 호출하세요. 내용을 추측하지 마세요.
- 지문/코드/테스트 같은 산출물은 채팅에 늘어놓지 말고 반드시 도구로 초안에 반영하세요.
- 지문은 '## 문제 / ## 입력 / ## 출력 / ## 제한 / ## 예시 설명' 구조를 따르고, 테스트는 공개 예시 2개 이상 + 경계값을 포함한 비공개 케이스를 갖추세요.
- 편집을 마치면 무엇을 바꿨는지 한두 문장으로만 요약하세요."""

# 호스트 도구를 붙일 수 없는 공급자(Claude Code CLI)용 — 도구 없이 도는 턴에
# "초안을 편집했다"는 거짓 약속이 나오지 않도록 프롬프트 자체를 대화 전용으로 바꾼다.
CHAT_ONLY_SYSTEM_PROMPT = """당신은 Harnesser 코딩 테스트 문제 작성 도우미입니다.

현재 선택된 LLM 공급자는 도구 호출을 지원하지 않아 초안을 직접 편집할 수 없습니다 — 편집했다고 말하지 마세요.
- 지문/코드/테스트 등 산출물은 관리자가 그대로 복사해 붙여넣을 수 있는 완성된 형태로 채팅에 제시하세요.
- 초안 내용은 매 턴 주입되는 '열린 탭' 컨텍스트로만 알 수 있습니다. 모르는 내용은 추측하지 말고 확인을 요청하세요.
- 지문은 '## 문제 / ## 입력 / ## 출력 / ## 제한 / ## 예시 설명' 구조를 따르고, 테스트는 공개 예시 2개 이상 + 경계값 케이스를 제안하세요."""

_TEST_CASE_SCHEMA = {
    "type": "object",
    "properties": {
        "input": {"type": "string", "maxLength": MAX_TEXT_CHARS},
        "expected_output": {"type": "string", "maxLength": MAX_TEXT_CHARS},
        "is_sample": {"type": "boolean"},
        "weight": {"type": "integer", "minimum": 1, "maximum": 100},
    },
    "required": ["input", "expected_output", "is_sample", "weight"],
    "additionalProperties": False,
}

AUTHORING_TOOLS: list[dict] = [
    {
        "name": "get_draft",
        "description": "현재 문제 초안 전체(기본 정보, 지문, 시작 코드, 테스트 케이스)와 열린 탭을 JSON으로 반환합니다.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "update_basic_info",
        "description": "기본 정보 탭을 부분 수정합니다. 전달한 필드만 변경됩니다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "minLength": 1, "maxLength": 200},
                "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                "time_limit_ms": {"type": "integer", "minimum": 100, "maximum": 20000},
                "memory_limit_mb": {"type": "integer", "minimum": 32, "maximum": 2048},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "update_statement",
        "description": "지문(Markdown) 전체를 교체합니다.",
        "input_schema": {
            "type": "object",
            "properties": {"statement_md": {"type": "string", "maxLength": MAX_TEXT_CHARS}},
            "required": ["statement_md"],
            "additionalProperties": False,
        },
    },
    {
        "name": "update_starter_code",
        "description": "특정 언어의 시작 코드를 교체합니다. 언어별로 한 번씩 호출하세요.",
        "input_schema": {
            "type": "object",
            "properties": {
                "language": {"type": "string", "enum": ["python", "cpp", "java", "go"]},
                "code": {"type": "string", "maxLength": MAX_TEXT_CHARS},
            },
            "required": ["language", "code"],
            "additionalProperties": False,
        },
    },
    {
        "name": "set_test_cases",
        "description": "테스트 케이스 목록 전체를 교체합니다 (기존 목록은 사라집니다).",
        "input_schema": {
            "type": "object",
            "properties": {
                "test_cases": {"type": "array", "items": _TEST_CASE_SCHEMA, "maxItems": 50}
            },
            "required": ["test_cases"],
            "additionalProperties": False,
        },
    },
    {
        "name": "add_test_case",
        "description": "테스트 케이스 하나를 목록 끝에 추가합니다.",
        "input_schema": _TEST_CASE_SCHEMA,
    },
    {
        "name": "open_tab",
        "description": "작성 화면의 탭을 전환해 사용자에게 특정 영역을 보여줍니다.",
        "input_schema": {
            "type": "object",
            "properties": {"tab": {"type": "string", "enum": ["basic", "statement", "starter", "tests"]}},
            "required": ["tab"],
            "additionalProperties": False,
        },
    },
]

_SCHEMA_BY_NAME = {t["name"]: t["input_schema"] for t in AUTHORING_TOOLS}

TAB_LABELS = {"basic": "기본 정보", "statement": "문제(지문)", "starter": "시작 코드", "tests": "테스트 케이스"}


def validate_tool_input(name: str, tool_input: Any) -> str | None:
    """도구 입력 검증 — 위반 사유 문자열 또는 None(정상)."""
    schema = _SCHEMA_BY_NAME.get(name)
    if schema is None:
        return f"알 수 없는 도구: {name}"
    try:
        jsonschema.validate(tool_input or {}, schema)
    except jsonschema.ValidationError as e:
        return f"입력 스키마 위반: {e.message}"
    return None


# send(event: dict) — 클라이언트로 봉투 송신
SendFn = Callable[[dict], Awaitable[None]]
# request_tool(call_id, name, input) -> 결과 문자열 (클라이언트 초안에 적용)
ToolFn = Callable[[str, str, dict], Awaitable[str]]


def build_context_note(active_tab: str, tab_context: str) -> str:
    label = TAB_LABELS.get(active_tab, active_tab)
    note = f"[컨텍스트] 현재 열린 탭: {label}"
    context = (tab_context or "").strip()
    if context:
        note += f"\n[열린 탭 내용]\n{context[:8000]}"
    return note


async def run_turn(
    res: ai_provider.ResolvedAi,
    messages: list[dict],
    req_id: str,
    send: SendFn,
    request_tool: ToolFn,
) -> None:
    """도구 루프 1턴 — messages는 호출자가 유지하는 canonical 대화 이력(직접 변형)."""
    client = ai_provider.build_client(res)

    if not ai_provider.supports_host_tools(res):
        # 대화 전용 폴백 — 도구 없이 한 번의 완성 호출로 답한다.
        response = await client.create_message(
            model_config=ai_provider._model_config(res),
            messages=messages,
            system=CHAT_ONLY_SYSTEM_PROMPT,
            tools=None,
            purpose="harnesser.authoring.chat_only",
        )
        text = (response.text or "").strip()
        if text:
            await send({"type": "assistant_text", "req_id": req_id, "text": text})
        messages.append({"role": "assistant", "content": text or "(응답 없음)"})
        return

    for _ in range(MAX_ITERATIONS):
        response = await client.create_message(
            model_config=ai_provider._model_config(res),
            messages=messages,
            system=SYSTEM_PROMPT,
            tools=AUTHORING_TOOLS,
            purpose="harnesser.authoring",
        )
        text = (response.text or "").strip()
        tool_calls = response.tool_calls

        if text:
            await send({"type": "assistant_text", "req_id": req_id, "text": text})

        if not tool_calls:
            messages.append({"role": "assistant", "content": text or "(응답 없음)"})
            return

        assistant_content: list[dict] = []
        if text:
            assistant_content.append({"type": "text", "text": text})
        for block in tool_calls:
            assistant_content.append(
                {
                    "type": "tool_use",
                    "id": block.tool_use_id,
                    "name": block.tool_name,
                    "input": block.tool_input or {},
                }
            )
        messages.append({"role": "assistant", "content": assistant_content})

        results: list[dict] = []
        for block in tool_calls:
            error = validate_tool_input(block.tool_name, block.tool_input)
            if error:
                result = f"거부됨 — {error}"
            else:
                result = await request_tool(block.tool_use_id, block.tool_name, block.tool_input or {})
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.tool_use_id,
                    "content": str(result)[:MAX_TOOL_RESULT_CHARS],
                }
            )
        messages.append({"role": "user", "content": results})

    await send(
        {
            "type": "assistant_text",
            "req_id": req_id,
            "text": "(도구 호출 한도에 도달해 이번 턴을 중단했습니다. 이어서 요청해 주세요.)",
        }
    )
    messages.append({"role": "assistant", "content": "(도구 호출 한도 도달)"})


def trim_history(messages: list[dict], max_items: int = 60) -> list[dict]:
    """대화 이력 상한 — 앞에서 자르되 tool_result 고아가 남지 않게 user 경계에서 자른다."""
    if len(messages) <= max_items:
        return messages
    trimmed = messages[-max_items:]
    while trimmed and not (
        trimmed[0].get("role") == "user" and isinstance(trimmed[0].get("content"), str)
    ):
        trimmed.pop(0)
    return trimmed or messages[-2:]

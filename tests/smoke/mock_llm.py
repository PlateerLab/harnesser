"""모의 OpenAI 호환 LLM 서버 — harnesser 다중 백엔드 E2E 검증용.

/v1/models, /v1/chat/completions (stream + non-stream)를 제공한다.
Claude Code CLI 공급자 E2E용으로 Anthropic Messages API(/v1/messages,
stream + non-stream)도 흉내낸다 — CLI에 ANTHROPIC_BASE_URL로 지정해 쓴다.
"""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "mock-model"
REPLY = "정상 — 모의 LLM 응답입니다."


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            self._json({"object": "list", "data": [
                {"id": MODEL, "object": "model", "created": 0, "owned_by": "mock"},
                {"id": "mock-model-large", "object": "model", "created": 0, "owned_by": "mock"},
            ]})
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path.endswith("/messages"):
            return self._anthropic_messages()
        if not path.endswith("/chat/completions"):
            return self._json({"error": "not found"}, 404)
        length = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(length) or b"{}")
        model = req.get("model", MODEL)
        now = int(time.time())

        # "slow" 모델은 단어당 지연을 넣어 리플레이/취소 테스트를 가능하게 한다
        slow = "slow" in model
        reply = ("느린 " * 30 + "응답 끝").strip() if slow else REPLY

        if req.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            words = reply.split(" ")
            for i, w in enumerate(words):
                if slow:
                    time.sleep(0.15)
                chunk = {
                    "id": "chatcmpl-mock", "object": "chat.completion.chunk", "created": now,
                    "model": model,
                    "choices": [{"index": 0, "delta": {"content": ("" if i == 0 else " ") + w}, "finish_reason": None}],
                }
                self.wfile.write(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode())
                self.wfile.flush()
            final = {
                "id": "chatcmpl-mock", "object": "chat.completion.chunk", "created": now,
                "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            usage = {
                "id": "chatcmpl-mock", "object": "chat.completion.chunk", "created": now,
                "model": model, "choices": [],
                "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
            }
            self.wfile.write(f"data: {json.dumps(final)}\n\n".encode())
            self.wfile.write(f"data: {json.dumps(usage)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            # 도구 시나리오 (authoring 에이전트 루프 테스트용)
            msgs = req.get("messages", [])
            last_user = next((m for m in reversed(msgs) if m.get("role") == "user"), {})
            last_text = str(last_user.get("content", ""))
            if req.get("tools"):
                last = msgs[-1] if msgs else {}
                tool_content = str(last.get("content", "")) if last.get("role") == "tool" else ""
                # 참고자료 시나리오 — 도구 결과(tool_content) 분기를 먼저 처리
                if "IndexError" in tool_content:  # 파일 내용을 읽은 뒤 → 최종 답변
                    return self._json(self._text_resp(model, now, "로그 확인 완료: 빈 아이템으로 인한 IndexError로 보입니다."))
                if tool_content.startswith("["):  # 파일 목록을 받은 뒤 → 특정 파일 열람
                    return self._json(self._named_tool_resp(model, now, "read_reference_file", {"path": "logs/server_error.log"}))
                # 도구 결과가 마지막이면 키워드 분기보다 먼저 종결해야 한다 — 마지막
                # user 메시지("도구테스트" 등)는 다음 턴에도 남아 있어, 키워드를 먼저
                # 보면 같은 도구를 무한 반복 호출한다.
                if last.get("role") == "tool":
                    return self._json(self._text_resp(model, now, "도구 결과 확인: " + tool_content[:80]))
                if "자료봐줘" in last_text:
                    return self._json(self._named_tool_resp(model, now, "list_reference_files", {}))
                if "검증테스트" in last_text:
                    return self._json(self._tool_resp(model, now, {"statement_md": 123}))
                if "도구테스트" in last_text:
                    return self._json(self._tool_resp(model, now, {"statement_md": "## 문제\n\n모의 지문입니다."}))
            self._json(self._text_resp(model, now, REPLY))

    def _anthropic_messages(self):
        """Anthropic Messages API 흉내 — Claude Code CLI E2E용 (stream + non-stream)."""
        length = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(length) or b"{}")
        model = req.get("model", "claude-mock")
        reply = REPLY

        def sse(event, data):
            self.wfile.write(f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode())
            self.wfile.flush()

        if req.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            sse("message_start", {"type": "message_start", "message": {
                "id": "msg_mock", "type": "message", "role": "assistant", "content": [],
                "model": model, "stop_reason": None, "stop_sequence": None,
                "usage": {"input_tokens": 10, "output_tokens": 1}}})
            sse("content_block_start", {"type": "content_block_start", "index": 0,
                                        "content_block": {"type": "text", "text": ""}})
            for i, w in enumerate(reply.split(" ")):
                sse("content_block_delta", {"type": "content_block_delta", "index": 0,
                                            "delta": {"type": "text_delta", "text": ("" if i == 0 else " ") + w}})
            sse("content_block_stop", {"type": "content_block_stop", "index": 0})
            sse("message_delta", {"type": "message_delta",
                                  "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                                  "usage": {"output_tokens": 8}})
            sse("message_stop", {"type": "message_stop"})
        else:
            self._json({
                "id": "msg_mock", "type": "message", "role": "assistant",
                "content": [{"type": "text", "text": reply}],
                "model": model, "stop_reason": "end_turn", "stop_sequence": None,
                "usage": {"input_tokens": 10, "output_tokens": 8},
            })

    def _text_resp(self, model, now, text):
        return {
            "id": "chatcmpl-mock", "object": "chat.completion", "created": now, "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
        }

    def _named_tool_resp(self, model, now, tool_name, args):
        return {
            "id": "chatcmpl-mock", "object": "chat.completion", "created": now, "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": None, "tool_calls": [
                {"id": "call_ref", "type": "function",
                 "function": {"name": tool_name, "arguments": json.dumps(args, ensure_ascii=False)}}
            ]}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
        }

    def _tool_resp(self, model, now, args):
        return {
            "id": "chatcmpl-mock", "object": "chat.completion", "created": now, "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": None, "tool_calls": [
                {"id": "call_mock_1", "type": "function",
                 "function": {"name": "update_statement", "arguments": json.dumps(args, ensure_ascii=False)}}
            ]}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
        }


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 18001), Handler)
    print("mock LLM on :18001", flush=True)
    server.serve_forever()

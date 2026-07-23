"""모의 OpenAI 호환 LLM 서버 — harnesser 다중 백엔드 E2E 검증용.

/v1/models, /v1/chat/completions (stream + non-stream)를 제공한다.
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
        if not self.path.rstrip("/").endswith("/chat/completions"):
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
            self._json({
                "id": "chatcmpl-mock", "object": "chat.completion", "created": now, "model": model,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": REPLY}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
            })


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 18001), Handler)
    print("mock LLM on :18001", flush=True)
    server.serve_forever()

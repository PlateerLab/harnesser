"""Claude Code (CLI) 공급자 풀스택 E2E — 모의 Anthropic 서버로 실 CLI 스폰까지 검증.

api 컨테이너에 claude CLI가 설치되어 있어야 하며(기본 Dockerfile), mock_llm.py가
게이트웨이에서 /v1/messages를 서빙해야 한다. 사용법:
    python3 mock_llm.py &
    python3 test_claude_code.py "http://<gateway>:18001"   # /v1 없이 host:port만
"""
import sys, requests

API = "http://localhost:8000"
MOCK_ROOT = sys.argv[1].rstrip("/")  # 예: http://172.25.3.1:18001
if MOCK_ROOT.endswith("/v1"):
    MOCK_ROOT = MOCK_ROOT[:-3]
ok = fail = 0

def check(name, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  PASS {name}")
    else: fail += 1; print(f"  FAIL {name} {detail}")

ad = requests.Session()
ad.post(f"{API}/auth/login", json={"email": "admin@harnesser.dev", "password": "admin1234"})

# 0. 초기 상태 정리
for p in ad.get(f"{API}/admin/settings/ai/providers").json():
    ad.delete(f"{API}/admin/settings/ai/providers/{p['id']}")

# 1. 공급자 생성 — base_url은 ANTHROPIC_BASE_URL로 CLI에 전달된다
p = ad.post(f"{API}/admin/settings/ai/providers", json={
    "name": "Claude Code E2E", "provider": "claude_code_cli",
    "base_url": MOCK_ROOT, "api_key": "sk-ant-mock-e2e", "model": "sonnet"}).json()
check("provider created", p.get("provider") == "claude_code_cli" and p.get("is_chat_default"), str(p)[:200])
check("host tools flagged off", p.get("supports_host_tools") is False, str(p.get("supports_host_tools")))

# 2. 정적 모델 카탈로그
m = ad.post(f"{API}/admin/settings/ai/models", json={"provider_id": p["id"]}).json()
check("static models", m["source"] == "static" and {x["id"] for x in m["models"]} >= {"sonnet", "opus", "haiku"}, str(m)[:200])

# 3. 라이브 연결 테스트 — 실제 CLI 스폰 → mock Anthropic 응답
t = ad.post(f"{API}/admin/settings/ai/test", json={"provider_id": p["id"]}).json()
check("live test spawns CLI", t.get("ok") and "정상" in t.get("reply", ""), str(t)[:400])

# 4. 유효 설정 반영
st = ad.get(f"{API}/ai/status").json()
check("status resolves claude_code", st["configured"] and st["provider"] == "claude_code_cli", str(st))

# 5. 응시자 채팅 E2E (SSE) — 스트리밍 → 기록 → 모델 스탬프
rows = ad.get(f"{API}/my/assignments").json()
ai_a = next(x for x in rows if x["mode"] == "ai_assisted")
if ai_a["attempt_id"]: ad.delete(f"{API}/attempts/{ai_a['attempt_id']}")
at = ad.post(f"{API}/assessments/{ai_a['assessment_id']}/attempts").json()
r = ad.post(f"{API}/attempts/{at['id']}/ai/chat", json={"problem_id": at["problems"][0]["id"], "content": "안녕"})
check("chat stream 200 + delta", r.status_code == 200 and '"delta"' in r.text and '"done"' in r.text, f"{r.status_code} {r.text[:300]}")
msgs = ad.get(f"{API}/attempts/{at['id']}/ai/messages").json()
check("turn recorded", len(msgs) == 2 and msgs[1]["role"] == "assistant" and "모의 LLM" in msgs[1]["content"], str(msgs)[-300:])
check("model stamped", msgs[1].get("model") == "sonnet", str(msgs[1].get("model")))

# 6. 정리
ad.delete(f"{API}/attempts/{at['id']}")
ad.delete(f"{API}/admin/settings/ai/providers/{p['id']}")
print(f"\n=== {ok} passed, {fail} failed ===")
sys.exit(1 if fail else 0)

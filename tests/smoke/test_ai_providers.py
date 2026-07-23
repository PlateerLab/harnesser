"""v0.5 스모크: 다중 LLM 공급자 시스템 (geny-executor 기반) — 모의 서버로 풀 E2E."""
import sys, requests

API = "http://localhost:8000"
MOCK_BASE = sys.argv[1]  # 예: http://172.18.0.1:18001/v1
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

# 1. 메타/카탈로그
meta = ad.get(f"{API}/admin/settings/ai/meta").json()
kinds = {c["provider"] for c in meta["catalog"]}
check("catalog 7 providers", kinds == {"openai","anthropic","google","vllm","ollama","lmstudio","custom"}, str(kinds))
check("unconfigured initially", meta["effective_chat"] is None or not meta["effective_chat"]["configured"], str(meta["effective_chat"]))

# 2. 검증 규칙
r = ad.post(f"{API}/admin/settings/ai/providers", json={"name":"x","provider":"custom","model":"m"})
check("custom needs base_url (400)", r.status_code == 400, str(r.status_code))
r = ad.post(f"{API}/admin/settings/ai/providers", json={"name":"x","provider":"anthropic","model":"m"})
check("anthropic needs key (400)", r.status_code == 400, str(r.status_code))
r = ad.post(f"{API}/admin/settings/ai/providers", json={"name":"x","provider":"nope","model":"m"})
check("unknown provider (400)", r.status_code == 400, str(r.status_code))

# 3. 모의 서버 공급자 생성 (custom)
p1 = ad.post(f"{API}/admin/settings/ai/providers", json={
    "name": "모의 커스텀", "provider": "custom", "base_url": MOCK_BASE,
    "api_key": "", "model": "mock-model", "temperature": 0.1, "max_tokens": 1024}).json()
check("provider created + auto default", p1["is_chat_default"] and p1["is_eval_default"], str(p1)[:200])

# 4. 라이브 모델 디스커버리
m = ad.post(f"{API}/admin/settings/ai/models", json={"provider_id": p1["id"]}).json()
check("model discovery live", m["source"] == "live" and any(x["id"] == "mock-model" for x in m["models"]), str(m)[:200])

# 5. 연결 테스트 (저장된 공급자)
t = ad.post(f"{API}/admin/settings/ai/test", json={"provider_id": p1["id"]}).json()
check("live test ok", t["ok"] and "정상" in t.get("reply",""), str(t)[:300])

# 6. ai/status 반영
st = ad.get(f"{API}/ai/status").json()
check("status resolves provider", st["configured"] and st["provider"] == "custom" and st["model"] == "mock-model", str(st))

# 7. 실제 채팅 E2E (스트리밍 → 기록 → usage)
rows = ad.get(f"{API}/my/assignments").json()
ai_a = next(x for x in rows if x["mode"] == "ai_assisted")
if ai_a["attempt_id"]: ad.delete(f"{API}/attempts/{ai_a['attempt_id']}")
at = ad.post(f"{API}/assessments/{ai_a['assessment_id']}/attempts").json()
u0 = ad.get(f"{API}/attempts/{at['id']}/ai/usage").json()
check("usage carries model", u0["configured"] and u0["model"] == "mock-model", str(u0))
r = ad.post(f"{API}/attempts/{at['id']}/ai/chat", json={"problem_id": at["problems"][0]["id"], "content": "괄호 문제 힌트 줘"})
check("chat stream 200 + delta", r.status_code == 200 and '"delta"' in r.text and '"done"' in r.text, f"{r.status_code} {r.text[:200]}")
msgs = ad.get(f"{API}/attempts/{at['id']}/ai/messages").json()
check("turn recorded", len(msgs) == 2 and msgs[1]["role"] == "assistant" and "모의 LLM" in msgs[1]["content"], str(msgs)[-200:])
check("model stamped", msgs[1]["model"] == "mock-model", str(msgs[1]["model"]))
u1 = ad.get(f"{API}/attempts/{at['id']}/ai/usage").json()
check("turn consumed", u1["used"] == 1, str(u1))

# 8. 두 번째 공급자(vllm 타입) + 시험별 오버라이드
p2 = ad.post(f"{API}/admin/settings/ai/providers", json={
    "name": "모의 vLLM", "provider": "vllm", "base_url": MOCK_BASE,
    "model": "mock-model-large", "max_tokens": 2048}).json()
check("second provider", p2["is_chat_default"] is False, str(p2)[:150])
probs = ad.get(f"{API}/problems").json()
a2 = ad.post(f"{API}/assessments", json={
    "title": "공급자 오버라이드 테스트", "mode": "ai_assisted", "duration_min": 30,
    "ai_max_turns": 5, "ai_provider_id": p2["id"],
    "problems": [{"problem_id": probs[0]["id"], "points": 100}], "assignee_ids": []}).json()
check("assessment stores provider", a2["ai_provider_id"] == p2["id"], str(a2.get("ai_provider_id")))
at2 = ad.post(f"{API}/assessments/{a2['id']}/attempts").json()
u2 = ad.get(f"{API}/attempts/{at2['id']}/ai/usage").json()
check("override resolved in usage", u2["model"] == "mock-model-large" and u2["provider"] == "vllm", str(u2))
r = ad.post(f"{API}/attempts/{at2['id']}/ai/chat", json={"problem_id": None, "content": "hi"})
msgs2 = ad.get(f"{API}/attempts/{at2['id']}/ai/messages").json()
check("override chat works", r.status_code == 200 and msgs2[-1]["model"] == "mock-model-large", str(msgs2[-1].get("model")))

# 9. 기본 지정 변경 (평가 기본 → p2)
rows2 = ad.put(f"{API}/admin/settings/ai/defaults", json={"eval_provider_id": p2["id"]}).json()
p2r = next(x for x in rows2 if x["id"] == p2["id"])
p1r = next(x for x in rows2 if x["id"] == p1["id"])
check("eval default moved", p2r["is_eval_default"] and not p1r["is_eval_default"] and p1r["is_chat_default"], str([(x["name"],x["is_chat_default"],x["is_eval_default"]) for x in rows2]))
meta2 = ad.get(f"{API}/admin/settings/ai/meta").json()
check("meta effective split", meta2["effective_chat"]["model"] == "mock-model" and meta2["effective_eval"]["model"] == "mock-model-large", str(meta2["effective_chat"])+str(meta2["effective_eval"]))

# 10. 자동평가가 평가 기본 공급자로 동작 (모의 서버 → JSON 아님 → 관대 파싱 폴백)
ad.post(f"{API}/attempts/{at['id']}/finish")
ev = ad.post(f"{API}/review/attempts/{at['id']}/autoeval")
check("autoeval via provider", ev.status_code == 200 and ev.json()["kind"] == "auto", ev.text[:200])
check("autoeval stamped by eval provider", ev.json()["scores"].get("evaluated_by", {}).get("model") == "mock-model-large", str(ev.json()["scores"].get("evaluated_by")))

# 11. 비활성화 시 폴백
ad.put(f"{API}/admin/settings/ai/providers/{p1['id']}", json={
    "name": p1["name"], "provider": "custom", "base_url": MOCK_BASE, "api_key": None,
    "model": "mock-model", "temperature": 0.1, "max_tokens": 1024, "enabled": False})
st2 = ad.get(f"{API}/ai/status").json()
check("disabled falls to next provider", st2["configured"] and st2["model"] == "mock-model-large", str(st2))

# 12. 권한: 응시자 차단
cd = requests.Session()
cd.post(f"{API}/auth/login", json={"email": "candidate@harnesser.dev", "password": "cand1234"})
r = cd.get(f"{API}/admin/settings/ai/providers")
check("candidate blocked", r.status_code == 403, str(r.status_code))

# 정리
ad.delete(f"{API}/attempts/{at2['id']}"); ad.delete(f"{API}/attempts/{at['id']}")
ad.delete(f"{API}/assessments/{a2['id']}")
for p in ad.get(f"{API}/admin/settings/ai/providers").json():
    ad.delete(f"{API}/admin/settings/ai/providers/{p['id']}")
print(f"\n=== {ok} passed, {fail} failed ===")
sys.exit(1 if fail else 0)

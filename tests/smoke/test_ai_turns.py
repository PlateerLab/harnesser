"""v0.3 스모크: AI 턴 한도(강제/환불/usage) + 새 시드 문제 검증."""
import sys, requests

API = "http://localhost:8000"
ok = fail = 0

def check(name, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  PASS {name}")
    else: fail += 1; print(f"  FAIL {name} {detail}")

ad = requests.Session()
ad.post(f"{API}/auth/login", json={"email": "admin@harnesser.dev", "password": "admin1234"})

# ── 새 시드 문제 검증 ──
probs = ad.get(f"{API}/problems").json()
check("seed 3 problems", len(probs) == 3, str(len(probs)))
brackets = next(p for p in probs if p["title"] == "올바른 괄호")
detail = ad.get(f"{API}/problems/{brackets['id']}").json()
check("brackets 7 tests", len(detail["test_cases"]) == 7, str(len(detail["test_cases"])))
check("statement has 제한 section", "## 제한" in detail["statement_md"])
check("statement has 예시 설명", "## 예시 설명" in detail["statement_md"])
check("starter all 4 languages", set(detail["starter_code"].keys()) == {"python","cpp","java","go"}, str(detail["starter_code"].keys()))
check("big hidden test", any(len(t["input"]) > 9000 for t in detail["test_cases"]))
asmts = ad.get(f"{API}/assessments").json()
ai_demo = next(a for a in asmts if a["mode"] == "ai_assisted")
check("seed ai_max_turns=20", ai_demo["ai_max_turns"] == 20, str(ai_demo.get("ai_max_turns")))

# ── 도달 불가 공급자 설정 (턴 환불 테스트용) ──
_p = ad.post(f"{API}/admin/settings/ai/providers", json={
    "name": "unreachable", "provider": "custom", "base_url": "http://127.0.0.1:9/v1",
    "api_key": "", "model": "x"}).json()

# ── ai_max_turns=2 시험 생성 ──
a = ad.post(f"{API}/assessments", json={
    "title": "턴한도 테스트", "mode": "ai_assisted", "duration_min": 30, "ai_max_turns": 2,
    "problems": [{"problem_id": brackets["id"], "points": 100}], "assignee_ids": []}).json()
check("create with ai_max_turns=2", a["ai_max_turns"] == 2, str(a)[:200])
at = ad.post(f"{API}/assessments/{a['id']}/attempts").json()
u = ad.get(f"{API}/attempts/{at['id']}/ai/usage").json()
check("usage initial", all(u[k] == v for k, v in {"enabled": True, "used": 0, "max": 2, "remaining": 2}.items()), str(u))

# 가짜 키로 채팅 → 공급자 오류 → 턴 환불되어 used=0 유지
r = ad.post(f"{API}/attempts/{at['id']}/ai/chat", json={"problem_id": None, "content": "hello"})
check("chat SSE 200 with provider error", r.status_code == 200 and "error" in r.text, f"{r.status_code} {r.text[:150]}")
u = ad.get(f"{API}/attempts/{at['id']}/ai/usage").json()
check("failed turn refunded", u["used"] == 0 and u["remaining"] == 2, str(u))
msgs = ad.get(f"{API}/attempts/{at['id']}/ai/messages").json()
check("failed turn still recorded", len(msgs) == 2, str(len(msgs)))  # user + assistant(error)

# ── ai_max_turns=0 시험 → 즉시 429 ──
a0 = ad.post(f"{API}/assessments", json={
    "title": "턴0 테스트", "mode": "ai_assisted", "duration_min": 30, "ai_max_turns": 0,
    "problems": [{"problem_id": brackets["id"], "points": 100}], "assignee_ids": []}).json()
at0 = ad.post(f"{API}/assessments/{a0['id']}/attempts").json()
r = ad.post(f"{API}/attempts/{at0['id']}/ai/chat", json={"problem_id": None, "content": "hi"})
check("limit enforced 429", r.status_code == 429, str(r.status_code))
u0 = ad.get(f"{API}/attempts/{at0['id']}/ai/usage").json()
check("usage remaining 0", u0["remaining"] == 0, str(u0))

# ── 정리 ──
ad.delete(f"{API}/assessments/{a['id']}"); ad.delete(f"{API}/assessments/{a0['id']}")
ad.delete(f"{API}/admin/settings/ai/providers/{_p['id']}")
st = ad.get(f"{API}/ai/status").json()
check("cleanup provider removed", st["configured"] is False, str(st))

print(f"\n=== {ok} passed, {fail} failed ===")
sys.exit(1 if fail else 0)

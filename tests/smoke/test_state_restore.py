"""v0.4 스모크: 상태 저장/복원(code_by_lang) + 실행 이력 복원 엔드포인트."""
import sys, time, requests

API = "http://localhost:8000"
ok = fail = 0

def check(name, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  PASS {name}")
    else: fail += 1; print(f"  FAIL {name} {detail}")

ad = requests.Session()
ad.post(f"{API}/auth/login", json={"email": "admin@harnesser.dev", "password": "admin1234"})
rows = ad.get(f"{API}/my/assignments").json()
std = next(x for x in rows if x["mode"] == "standard")
if std["attempt_id"]:
    ad.delete(f"{API}/attempts/{std['attempt_id']}")
at = ad.post(f"{API}/assessments/{std['assessment_id']}/attempts").json()
pid = at["problems"][0]["id"]

# 1. 상태 저장 (언어별 코드 전체)
r = ad.post(f"{API}/attempts/{at['id']}/state", json={
    "problem_id": pid, "language": "cpp",
    "code_by_lang": {"python": "print('py-work')", "cpp": "// cpp-work"}}).json()
check("state saved", r == {"ok": True, "saved": True}, str(r))
a2 = ad.get(f"{API}/attempts/{at['id']}").json()
p2 = next(p for p in a2["problems"] if p["id"] == pid)
check("language restored", p2["saved_language"] == "cpp", str(p2["saved_language"]))
check("code restored (current lang)", p2["saved_code"] == "// cpp-work", str(p2["saved_code"]))
check("code_by_lang both kept", p2["saved_code_by_lang"] == {"python": "print('py-work')", "cpp": "// cpp-work"}, str(p2["saved_code_by_lang"]))

# 2. 스냅샷 이벤트는 해당 언어만 병합 (다른 언어 보존)
ad.post(f"{API}/attempts/{at['id']}/events", json={"events": [
    {"type": "code_snapshot", "problem_id": pid, "payload": {"language": "python", "code": "print('py-v2')"}}]})
a3 = ad.get(f"{API}/attempts/{at['id']}").json()
p3 = next(p for p in a3["problems"] if p["id"] == pid)
check("snapshot merged", p3["saved_code_by_lang"]["python"] == "print('py-v2')" and p3["saved_code_by_lang"]["cpp"] == "// cpp-work", str(p3["saved_code_by_lang"]))

# 3. 실행 이력 목록 (콘솔 복원용)
ex = ad.post(f"{API}/attempts/{at['id']}/executions", json={
    "problem_id": pid, "kind": "submit", "language": "python",
    "code": "import sys\na,b=map(int,sys.stdin.read().split())\nprint(a+b)\n"}).json()
for _ in range(60):
    d = ad.get(f"{API}/executions/{ex['id']}").json()
    if d["status"] in ("done", "error"): break
    time.sleep(1.5)
lst = ad.get(f"{API}/attempts/{at['id']}/executions").json()
check("executions list", len(lst) == 1 and lst[0]["verdict"] == "AC" and lst[0]["passed"] == lst[0]["total"] == 5, str(lst)[:200])

# 4. 종료 후 상태 저장은 no-op
ad.post(f"{API}/attempts/{at['id']}/finish")
r = ad.post(f"{API}/attempts/{at['id']}/state", json={"problem_id": pid, "language": "python", "code_by_lang": {"python": "late"}}).json()
check("state noop after finish", r["saved"] is False, str(r))

ad.delete(f"{API}/attempts/{at['id']}")
print(f"\n=== {ok} passed, {fail} failed ===")
sys.exit(1 if fail else 0)

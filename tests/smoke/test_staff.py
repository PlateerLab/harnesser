"""v0.2 기능 스모크: 스태프 체험 응시 + 다시 응시 + LLM 설정."""
import sys, time, requests

API = "http://localhost:8000"
ok_count = fail_count = 0

def check(name, cond, detail=""):
    global ok_count, fail_count
    if cond: ok_count += 1; print(f"  PASS {name}")
    else: fail_count += 1; print(f"  FAIL {name} {detail}")

def wait_execution(s, exec_id, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        ex = s.get(f"{API}/executions/{exec_id}").json()
        if ex["status"] in ("done", "error"): return ex
        time.sleep(1.5)
    return {}

ad = requests.Session()
r = ad.post(f"{API}/auth/login", json={"email": "admin@harnesser.dev", "password": "admin1234"})
check("admin login", r.status_code == 200)

# 1. 스태프는 전체 시험을 본다 (미배정 포함)
rows = ad.get(f"{API}/my/assignments").json()
check("admin sees all assessments", len(rows) >= 2, str(rows)[:200])
check("assigned flag false", all(x["assigned"] is False for x in rows), str([x["assigned"] for x in rows]))
std = next(x for x in rows if x["mode"] == "standard")

# 2. 미배정 시험 응시 시작 + 제출
at = ad.post(f"{API}/assessments/{std['assessment_id']}/attempts").json()
check("admin start without assignment", at.get("status") == "in_progress", str(at)[:200])
p = at["problems"][0]
ex = ad.post(f"{API}/attempts/{at['id']}/executions", json={
    "problem_id": p["id"], "kind": "submit", "language": "python",
    "code": "import sys\na,b=map(int,sys.stdin.read().split())\nprint(a+b)\n"}).json()
res = wait_execution(ad, ex["id"])
check("admin submit AC", res.get("verdict") == "AC", str(res)[:200])
ad.post(f"{API}/attempts/{at['id']}/finish")

# 3. 리뷰 목록에 체험 배지
rrows = ad.get(f"{API}/review/attempts").json()
mine = next((x for x in rrows if x["id"] == at["id"]), None)
check("review shows staff attempt", mine is not None and mine["is_staff"] is True, str(mine)[:200])

# 4. 다시 응시 (초기화)
r = ad.delete(f"{API}/attempts/{at['id']}")
check("attempt reset", r.status_code == 200, r.text[:100])
rows = ad.get(f"{API}/my/assignments").json()
std2 = next(x for x in rows if x["assessment_id"] == std["assessment_id"])
check("attempt gone after reset", std2["attempt_id"] is None)
at2 = ad.post(f"{API}/assessments/{std['assessment_id']}/attempts").json()
check("restart after reset", at2.get("status") == "in_progress")
ad.delete(f"{API}/attempts/{at2['id']}")

# 5. candidate는 초기화 불가
cd = requests.Session()
cd.post(f"{API}/auth/login", json={"email": "candidate@harnesser.dev", "password": "cand1234"})
my = cd.get(f"{API}/my/assignments").json()
check("candidate still sees only assigned", all(x["assigned"] for x in my))
target = next((x for x in my if x["attempt_id"]), None)
if target:
    r = cd.delete(f"{API}/attempts/{target['attempt_id']}")
    check("candidate cannot reset", r.status_code == 403, str(r.status_code))

# 6. LLM 설정 (다중 공급자 API — 상세 검증은 smoke5)
s = ad.get(f"{API}/admin/settings/ai/meta").json()
check("settings meta has catalog", len(s.get("catalog", [])) == 7, str(s)[:150])
r = cd.get(f"{API}/admin/settings/ai/providers")
check("candidate blocked from settings", r.status_code == 403, str(r.status_code))

print(f"\n=== {ok_count} passed, {fail_count} failed ===")
sys.exit(1 if fail_count else 0)

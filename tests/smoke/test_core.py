"""Harnesser E2E 스모크 테스트: 로그인→응시→4개 언어 채점→행동기록→리뷰."""

import sys
import time

import requests

API = "http://localhost:8000"
WEB = "http://localhost:3000"

SOLUTIONS = {
    "python": "import sys\na,b=map(int,sys.stdin.read().split())\nprint(a+b)\n",
    "cpp": '#include <bits/stdc++.h>\nusing namespace std;\nint main(){long long a,b;cin>>a>>b;cout<<a+b<<"\\n";}\n',
    "java": "import java.util.*;\npublic class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);System.out.println(s.nextLong()+s.nextLong());}}\n",
    "go": 'package main\nimport "fmt"\nfunc main(){var a,b int64;fmt.Scan(&a,&b);fmt.Println(a+b)}\n',
}
WRONG_PY = "print(42)\n"
TLE_PY = "while True: pass\n"

ok_count = 0
fail_count = 0


def check(name, cond, detail=""):
    global ok_count, fail_count
    if cond:
        ok_count += 1
        print(f"  PASS {name}")
    else:
        fail_count += 1
        print(f"  FAIL {name} {detail}")


def wait_execution(s, exec_id, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        ex = s.get(f"{API}/executions/{exec_id}").json()
        if ex["status"] in ("done", "error"):
            return ex
        time.sleep(1.5)
    return {"status": "timeout-in-test", "verdict": None}


def main():
    # 멱등성: 이전 실행이 남긴 응시 기록을 관리자 권한으로 정리
    _ad = requests.Session()
    _ad.post(f"{API}/auth/login", json={"email": "admin@harnesser.dev", "password": "admin1234"})
    for _r in _ad.get(f"{API}/review/attempts").json():
        _ad.delete(f"{API}/attempts/{_r['id']}")

    # 0. health
    r = requests.get(f"{API}/healthz", timeout=5)
    check("api healthz", r.status_code == 200)
    r = requests.get(f"{WEB}/api/healthz", timeout=10)
    check("web->api proxy", r.status_code == 200, r.text[:100])
    r = requests.get(f"{WEB}/login", timeout=15)
    check("web login page", r.status_code == 200 and "Harnesser" in r.text)
    r = requests.get(f"{WEB}/monaco/vs/loader.js", timeout=10)
    check("monaco self-hosted", r.status_code == 200)

    # 1. candidate login
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "candidate@harnesser.dev", "password": "cand1234"})
    check("candidate login", r.status_code == 200, r.text[:200])

    # 2. assignments
    rows = s.get(f"{API}/my/assignments").json()
    check("assignments >= 2", len(rows) >= 2, str(rows)[:200])
    std = next(x for x in rows if x["mode"] == "standard")
    ai = next(x for x in rows if x["mode"] == "ai_assisted")

    # 3. start standard attempt
    at = s.post(f"{API}/assessments/{std['assessment_id']}/attempts").json()
    check("attempt started", at.get("status") == "in_progress", str(at)[:300])
    attempt_id = at["id"]
    sum_problem = next(p for p in at["problems"] if p["title"] == "두 수의 합")
    check("samples visible", len(sum_problem["samples"]) == 2)

    # 4. behavior events
    r = s.post(
        f"{API}/attempts/{attempt_id}/events",
        json={
            "events": [
                {"type": "code_snapshot", "problem_id": sum_problem["id"], "payload": {"language": "python", "code": "print(1)"}},
                {"type": "paste", "problem_id": sum_problem["id"], "payload": {"chars": 20, "text": "pasted code sample"}},
                {"type": "focus_lost", "payload": {}},
                {"type": "focus_gained", "payload": {}},
            ]
        },
    )
    check("events recorded", r.json().get("recorded") == 4, r.text[:200])

    # 5. run (samples) then submit in 4 languages
    ex = s.post(
        f"{API}/attempts/{attempt_id}/executions",
        json={"problem_id": sum_problem["id"], "kind": "run", "language": "python", "code": SOLUTIONS["python"]},
    ).json()
    result = wait_execution(s, ex["id"])
    check("run python AC", result.get("verdict") == "AC", str(result)[:300])
    check("run only samples", result.get("total") == 2, str(result.get("total")))

    for lang, code in SOLUTIONS.items():
        ex = s.post(
            f"{API}/attempts/{attempt_id}/executions",
            json={"problem_id": sum_problem["id"], "kind": "submit", "language": lang, "code": code},
        )
        if ex.status_code != 200:
            check(f"submit {lang}", False, ex.text[:200])
            continue
        result = wait_execution(s, ex.json()["id"])
        check(
            f"submit {lang} AC score=100",
            result.get("verdict") == "AC" and result.get("score") == 100.0,
            f"verdict={result.get('verdict')} score={result.get('score')} compile={str(result.get('compile_output'))[:200]} results={str(result.get('results'))[:300]}",
        )

    # hidden test masking for candidate
    hidden = [t for t in result["results"] if not t["is_sample"]]
    check("hidden IO masked", all(t["input"] is None and t["stdout"] is None for t in hidden))

    # 6. WA + TLE
    ex = s.post(
        f"{API}/attempts/{attempt_id}/executions",
        json={"problem_id": sum_problem["id"], "kind": "submit", "language": "python", "code": WRONG_PY},
    ).json()
    result = wait_execution(s, ex["id"])
    check("WA detected", result.get("verdict") == "WA", str(result.get("verdict")))
    ex = s.post(
        f"{API}/attempts/{attempt_id}/executions",
        json={"problem_id": sum_problem["id"], "kind": "run", "language": "python", "code": TLE_PY},
    ).json()
    result = wait_execution(s, ex["id"], timeout=60)
    check("TLE detected", result.get("verdict") == "TLE", str(result.get("verdict")))

    # 7. finish
    r = s.post(f"{API}/attempts/{attempt_id}/finish").json()
    check("attempt finished", r.get("status") == "submitted")

    # 8. AI assessment: status + chat unconfigured behavior
    at2 = s.post(f"{API}/assessments/{ai['assessment_id']}/attempts").json()
    st = s.get(f"{API}/ai/status").json()
    if st.get("configured"):
        print("  (AI configured — skipping unconfigured-path check)")
    else:
        r = s.post(f"{API}/attempts/{at2['id']}/ai/chat", json={"problem_id": None, "content": "hi"})
        check("ai chat 503 when unconfigured", r.status_code == 503, str(r.status_code))
    # standard 시험에서 AI 차단 확인
    r = s.post(f"{API}/attempts/{attempt_id}/ai/chat", json={"problem_id": None, "content": "hi"})
    check("ai blocked in standard/finished", r.status_code in (400, 403), str(r.status_code))

    # 9. evaluator review
    ev = requests.Session()
    r = ev.post(f"{API}/auth/login", json={"email": "evaluator@harnesser.dev", "password": "eval1234"})
    check("evaluator login", r.status_code == 200)
    rows = ev.get(f"{API}/review/attempts").json()
    check("review list has attempt", any(x["id"] == attempt_id for x in rows), str(rows)[:200])
    row = next(x for x in rows if x["id"] == attempt_id)
    check("review score aggregated", row["total_score"] == 100.0, str(row["total_score"]))
    detail = ev.get(f"{API}/review/attempts/{attempt_id}").json()
    types = {e["type"] for e in detail["events"]}
    check(
        "review events complete",
        {"attempt_started", "code_snapshot", "paste", "focus_lost", "submit_requested", "submit_result", "attempt_finished"} <= types,
        str(types),
    )
    check("review sees hidden IO", any(t["input"] for p in detail["problems"] for t in p["test_cases"] if not t["is_sample"]))
    check("review sees code", all(x["code"] for x in detail["executions"]))
    # human evaluation
    r = ev.post(
        f"{API}/review/attempts/{attempt_id}/evaluations",
        json={"scores": {"overall_score": 88}, "summary": "스모크 테스트 평가 의견"},
    )
    check("human evaluation saved", r.status_code == 200, r.text[:200])
    # candidate는 review 접근 불가
    r = s.get(f"{API}/review/attempts")
    check("candidate blocked from review", r.status_code == 403, str(r.status_code))

    # 10. admin: problem CRUD round-trip
    ad = requests.Session()
    ad.post(f"{API}/auth/login", json={"email": "admin@harnesser.dev", "password": "admin1234"})
    p = ad.post(
        f"{API}/problems",
        json={
            "title": "smoke-temp",
            "statement_md": "temp",
            "test_cases": [{"input": "1\n", "expected_output": "1\n", "is_sample": True, "weight": 1}],
        },
    ).json()
    check("problem create", p.get("title") == "smoke-temp", str(p)[:200])
    r = ad.delete(f"{API}/problems/{p['id']}")
    check("problem archive", r.status_code == 200)

    print(f"\n=== {ok_count} passed, {fail_count} failed ===")
    sys.exit(1 if fail_count else 0)


if __name__ == "__main__":
    main()

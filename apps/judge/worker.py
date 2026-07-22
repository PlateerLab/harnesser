"""Harnesser 채점 워커.

Redis 큐(harnesser:judge:queue)에서 작업을 꺼내 컴파일/실행/비교 후
API 내부 엔드포인트로 결과를 콜백한다.
"""

import json
import os
import shutil
import stat
import threading
import time
import traceback
import uuid

import redis
import requests

from languages import LANGUAGES
from sandbox import execute

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000")
INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN", "harnesser-internal-change-me")
CONCURRENCY = int(os.environ.get("JUDGE_CONCURRENCY", "2"))

QUEUE_KEY = "harnesser:judge:queue"
WORK_ROOT = "/work"

COMPILE_WALL_S = 60
COMPILE_CPU_S = 60


def normalize(text: str) -> str:
    """채점 비교용 정규화: 각 줄 끝 공백 제거 + 끝의 빈 줄 제거."""
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


def judge_job(job: dict) -> dict:
    language = job["language"]
    spec = LANGUAGES.get(language)
    if not spec:
        return {"status": "error", "verdict": "IE", "compile_output": f"unsupported language: {language}", "results": []}

    time_limit_ms = int(job.get("time_limit_ms", 2000))
    memory_limit_mb = int(job.get("memory_limit_mb", 256))
    effective_wall_s = (time_limit_ms / 1000.0) * spec["time_mult"] + 2.0
    cpu_s = max(1, int((time_limit_ms / 1000.0) * spec["time_mult"]) + 1)

    workdir = os.path.join(WORK_ROOT, uuid.uuid4().hex)
    os.makedirs(workdir)
    # sandbox 사용자가 컴파일 산출물을 쓸 수 있어야 한다
    os.chmod(workdir, stat.S_IRWXU | stat.S_IRWXG | stat.S_IRWXO)
    try:
        with open(os.path.join(workdir, spec["source"]), "w", encoding="utf-8") as f:
            f.write(job["code"])

        # 컴파일
        if spec["compile"]:
            comp = execute(
                spec["compile"](),
                cwd=workdir,
                wall_s=COMPILE_WALL_S,
                cpu_s=COMPILE_CPU_S,
                mem_mb=None,
                nproc=512,
                env=spec.get("env", {}),
            )
            if comp.status != "ok" or comp.returncode != 0:
                output = (comp.stderr or comp.stdout or "compile failed").strip()[:8000]
                return {"status": "done", "verdict": "CE", "compile_output": output, "results": []}

        run_env = dict(spec.get("env", {}))
        if "run_env" in spec:
            run_env.update(spec["run_env"](memory_limit_mb))

        results = []
        worst = "AC"
        for test in job.get("tests", []):
            r = execute(
                spec["run"](memory_limit_mb),
                cwd=workdir,
                stdin_data=test.get("input", ""),
                wall_s=effective_wall_s,
                cpu_s=cpu_s,
                mem_mb=memory_limit_mb if spec["use_as_limit"] else None,
                env=run_env,
            )
            if r.status == "timeout":
                verdict = "TLE"
            elif r.status == "error" or r.returncode != 0:
                verdict = "RE"
            elif normalize(r.stdout) == normalize(test.get("expected", "")):
                verdict = "AC"
            else:
                verdict = "WA"
            if verdict != "AC" and worst == "AC":
                worst = verdict
            results.append(
                {
                    "test_id": test.get("id", ""),
                    "verdict": verdict,
                    "time_ms": r.time_ms,
                    "stdout": r.stdout[:4000],
                    "stderr": r.stderr[:2000],
                }
            )
        return {"status": "done", "verdict": worst, "compile_output": None, "results": results}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def report(execution_id: str, payload: dict) -> None:
    url = f"{API_BASE_URL}/internal/executions/{execution_id}/result"
    headers = {"X-Internal-Token": INTERNAL_TOKEN}
    for attempt in range(5):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=15)
            if resp.status_code < 500:
                return
        except requests.RequestException:
            pass
        time.sleep(2**attempt)
    print(f"[judge] FAILED to report result for {execution_id}", flush=True)


def mark_running(execution_id: str) -> None:
    try:
        requests.post(
            f"{API_BASE_URL}/internal/executions/{execution_id}/running",
            headers={"X-Internal-Token": INTERNAL_TOKEN},
            timeout=5,
        )
    except requests.RequestException:
        pass


def handle(raw: str) -> None:
    execution_id = "?"
    try:
        job = json.loads(raw)
        execution_id = job["execution_id"]
        mark_running(execution_id)
        started = time.monotonic()
        result = judge_job(job)
        print(
            f"[judge] {execution_id} {job['language']} -> {result.get('verdict')} "
            f"({time.monotonic() - started:.1f}s)",
            flush=True,
        )
        report(execution_id, result)
    except Exception:
        traceback.print_exc()
        report(execution_id, {"status": "error", "verdict": "IE", "compile_output": "internal judge error", "results": []})


def main() -> None:
    print(f"[judge] starting, concurrency={CONCURRENCY}", flush=True)
    conn = redis.from_url(REDIS_URL, decode_responses=True)
    slots = threading.Semaphore(CONCURRENCY)

    while True:
        try:
            item = conn.brpop(QUEUE_KEY, timeout=5)
        except redis.RedisError:
            time.sleep(2)
            continue
        if not item:
            continue
        _, raw = item
        slots.acquire()

        def run(raw=raw):
            try:
                handle(raw)
            finally:
                slots.release()

        threading.Thread(target=run, daemon=True).start()


if __name__ == "__main__":
    main()

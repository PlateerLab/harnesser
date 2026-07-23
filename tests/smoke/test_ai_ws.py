"""v0.6 스모크: AI 채팅 WebSocket — 스트리밍/리플레이/취소/엣지 경유/동시성 가드.

api 컨테이너 내부에서 실행한다 (websockets/httpx는 geny-executor 의존성으로 존재).
사용법: python3 smoke6.py <MOCK_BASE_URL>
"""

import asyncio
import json
import sys
import uuid

import httpx
import websockets

API = "http://localhost:8000"
WS = "ws://localhost:8000"
EDGE_WS = "ws://edge:80/api"
MOCK_BASE = sys.argv[1]

ok = fail = 0


def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS {name}")
    else:
        fail += 1
        print(f"  FAIL {name} {detail}")


async def collect_turn(ws, until="turn_end", limit=300):
    """turn_end까지 봉투 수집."""
    events = []
    for _ in range(limit):
        ev = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
        events.append(ev)
        if ev["type"] == until:
            break
    return events


async def main():
    client = httpx.AsyncClient(base_url=API, timeout=30)
    r = await client.post("/auth/login", json={"email": "admin@harnesser.dev", "password": "admin1234"})
    token = client.cookies.get("harnesser_token")
    check("login + token", r.status_code == 200 and bool(token))

    # 정리 + 공급자/시험 셋업
    for p in (await client.get("/admin/settings/ai/providers")).json():
        await client.delete(f"/admin/settings/ai/providers/{p['id']}")
    fast = (await client.post("/admin/settings/ai/providers", json={
        "name": "모의 fast", "provider": "custom", "base_url": MOCK_BASE, "model": "mock-model"})).json()
    slow = (await client.post("/admin/settings/ai/providers", json={
        "name": "모의 slow", "provider": "custom", "base_url": MOCK_BASE, "model": "mock-model-slow"})).json()
    probs = (await client.get("/problems")).json()
    a_fast = (await client.post("/assessments", json={
        "title": "WS fast", "mode": "ai_assisted", "duration_min": 30, "ai_max_turns": 5,
        "ai_provider_id": fast["id"], "problems": [{"problem_id": probs[0]["id"], "points": 100}], "assignee_ids": []})).json()
    a_slow = (await client.post("/assessments", json={
        "title": "WS slow", "mode": "ai_assisted", "duration_min": 30, "ai_max_turns": 5,
        "ai_provider_id": slow["id"], "problems": [{"problem_id": probs[0]["id"], "points": 100}], "assignee_ids": []})).json()
    at_fast = (await client.post(f"/assessments/{a_fast['id']}/attempts")).json()
    at_slow = (await client.post(f"/assessments/{a_slow['id']}/attempts")).json()

    # 1. 인증 가드 — accept 전 close는 HTTP 403 핸드셰이크 거부로 나타난다
    try:
        async with websockets.connect(f"{WS}/attempts/{at_fast['id']}/ai/ws") as ws:
            await ws.recv()
        check("ws rejects no-auth", False)
    except websockets.exceptions.ConnectionClosedError as e:
        check("ws rejects no-auth", e.code == 4401, str(e.code))
    except Exception as e:
        check("ws rejects no-auth", "403" in str(e) or "4401" in str(e), str(e)[:100])

    # 2. 기본 스트리밍 흐름
    url = f"{WS}/attempts/{at_fast['id']}/ai/ws?token={token}"
    async with websockets.connect(url) as ws:
        ready = json.loads(await ws.recv())
        check("ready envelope", ready["type"] == "ready" and ready["seq"] == 1 and ready["configured"] and ready["model"] == "mock-model", str(ready)[:200])
        await ws.send(json.dumps({"type": "ping"}))
        pong = json.loads(await ws.recv())
        check("heartbeat pong", pong["type"] == "pong", str(pong))
        req = str(uuid.uuid4())
        await ws.send(json.dumps({"type": "chat", "req_id": req, "problem_id": probs[0]["id"], "content": "안녕"}))
        events = await collect_turn(ws)
        types = [e["type"] for e in events]
        deltas = [e for e in events if e["type"] == "delta"]
        end = events[-1]
        check("turn_start first", types[0] == "turn_start" and events[0]["req_id"] == req, str(types[:3]))
        check("multiple deltas streamed", len(deltas) >= 2, str(len(deltas)))
        check("turn_end with usage+message", end["usage"]["used"] == 1 and end["message_id"] and not end["error"], str(end)[:200])
        seqs = [e["seq"] for e in events]
        check("seq monotonic", seqs == sorted(seqs) and len(set(seqs)) == len(seqs), str(seqs[:5]))
        # 동시성 가드: 턴 진행 중 재요청 → 409
        await ws.send(json.dumps({"type": "chat", "req_id": "x", "problem_id": None, "content": "a"}))
        await ws.send(json.dumps({"type": "chat", "req_id": "y", "problem_id": None, "content": "b"}))
        got = [json.loads(await ws.recv()) for _ in range(2)]
        errs = [e for e in got if e["type"] == "error" and e.get("code") == 409]
        check("concurrent turn guarded", len(errs) >= 1, str(got)[:200])
        # 남은 턴 정리
        rest = await collect_turn(ws)
        check("second turn completes", rest[-1]["type"] == "turn_end", str(rest[-1])[:100])

    # 3. 재접속 리플레이 (슬로우 모델: 중간에 끊고 재접속)
    url_slow = f"{WS}/attempts/{at_slow['id']}/ai/ws?token={token}"
    async with websockets.connect(url_slow) as ws:
        json.loads(await ws.recv())  # ready
        await ws.send(json.dumps({"type": "chat", "req_id": "slow1", "problem_id": None, "content": "천천히"}))
        # turn_start + 델타 2개만 받고 끊는다
        got = []
        while len([e for e in got if e["type"] == "delta"]) < 2:
            got.append(json.loads(await ws.recv()))
    await asyncio.sleep(0.5)
    async with websockets.connect(url_slow) as ws:
        ready = json.loads(await ws.recv())
        ev1 = json.loads(await ws.recv())
        check("replay turn_start", ev1["type"] == "turn_start" and ev1.get("replay") is True and ev1["req_id"] == "slow1", str(ev1)[:150])
        events = await collect_turn(ws)
        text = "".join(e.get("text", "") for e in events if e["type"] == "delta")
        check("replay then live deltas", len(text) > 20, str(len(text)))
        check("replay turn completes", events[-1]["type"] == "turn_end" and not events[-1]["error"], str(events[-1])[:150])
    msgs = (await client.get(f"/attempts/{at_slow['id']}/ai/messages")).json()
    final = [m for m in msgs if m["role"] == "assistant"][-1]
    check("full reply persisted despite disconnect", "응답 끝" in final["content"], final["content"][-40:])

    # 4. 취소
    async with websockets.connect(url_slow) as ws:
        json.loads(await ws.recv())  # ready
        await ws.send(json.dumps({"type": "chat", "req_id": "slow2", "problem_id": None, "content": "취소 테스트"}))
        got = []
        while len([e for e in got if e["type"] == "delta"]) < 2:
            got.append(json.loads(await ws.recv()))
        await ws.send(json.dumps({"type": "cancel"}))
        events = await collect_turn(ws)
        end = events[-1]
        check("cancel ends turn", end["type"] == "turn_end" and end["cancelled"] is True, str(end)[:150])
    msgs = (await client.get(f"/attempts/{at_slow['id']}/ai/messages")).json()
    final = [m for m in msgs if m["role"] == "assistant"][-1]
    check("cancelled partial persisted", 0 < len(final["content"]) and "응답 끝" not in final["content"], final["content"][:40])

    # 5. 엣지(nginx) 경유 WS
    url_edge = f"{EDGE_WS}/attempts/{at_fast['id']}/ai/ws?token={token}"
    async with websockets.connect(url_edge) as ws:
        ready = json.loads(await ws.recv())
        check("edge ws ready", ready["type"] == "ready", str(ready)[:120])
        await ws.send(json.dumps({"type": "chat", "req_id": "edge1", "problem_id": None, "content": "엣지"}))
        events = await collect_turn(ws)
        check("edge ws streams", any(e["type"] == "delta" for e in events) and events[-1]["type"] == "turn_end", str([e["type"] for e in events][:5]))

    # 정리
    await client.delete(f"/attempts/{at_fast['id']}")
    await client.delete(f"/attempts/{at_slow['id']}")
    await client.delete(f"/assessments/{a_fast['id']}")
    await client.delete(f"/assessments/{a_slow['id']}")
    for p in (await client.get("/admin/settings/ai/providers")).json():
        await client.delete(f"/admin/settings/ai/providers/{p['id']}")
    await client.aclose()

    print(f"\n=== {ok} passed, {fail} failed ===")
    sys.exit(1 if fail else 0)


asyncio.run(main())

"""v0.7 스모크: 문제 작성 에이전트 WS — 도구 루프/검증 경계/권한. (api 컨테이너 내부 실행)"""

import asyncio
import json
import sys

import httpx
import websockets

API = "http://localhost:8000"
WS = "ws://localhost:8000"
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


async def recv_until(ws, target, limit=50):
    events = []
    for _ in range(limit):
        ev = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
        events.append(ev)
        if ev["type"] == target:
            break
    return events


async def main():
    ad = httpx.AsyncClient(base_url=API, timeout=30)
    await ad.post("/auth/login", json={"email": "admin@harnesser.dev", "password": "admin1234"})
    admin_token = ad.cookies.get("harnesser_token")

    cd = httpx.AsyncClient(base_url=API, timeout=30)
    await cd.post("/auth/login", json={"email": "candidate@harnesser.dev", "password": "cand1234"})
    cand_token = cd.cookies.get("harnesser_token")

    for p in (await ad.get("/admin/settings/ai/providers")).json():
        await ad.delete(f"/admin/settings/ai/providers/{p['id']}")
    prov = (await ad.post("/admin/settings/ai/providers", json={
        "name": "모의", "provider": "custom", "base_url": MOCK_BASE, "model": "mock-model"})).json()

    # 1. 관리자 아닌 사용자는 거부
    try:
        async with websockets.connect(f"{WS}/authoring/ws?token={cand_token}") as ws:
            await ws.recv()
        check("non-admin rejected", False)
    except Exception as e:
        check("non-admin rejected", "403" in str(e) or "4403" in str(e), str(e)[:80])

    # 2. 도구 루프 E2E: chat → tool_call → tool_result → assistant_text → turn_end
    async with websockets.connect(f"{WS}/authoring/ws?token={admin_token}") as ws:
        ready = json.loads(await ws.recv())
        check("ready", ready["type"] == "ready", str(ready)[:120])
        await ws.send(json.dumps({
            "type": "chat", "req_id": "t1", "content": "도구테스트",
            "provider_id": prov["id"], "active_tab": "statement", "tab_context": "## 문제\n(비어 있음)"}))
        ev = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
        check("tool_call arrives", ev["type"] == "tool_call" and ev["name"] == "update_statement", str(ev)[:200])
        check("tool input valid json", ev["input"]["statement_md"].startswith("## 문제"), str(ev["input"])[:100])
        await ws.send(json.dumps({"type": "tool_result", "call_id": ev["call_id"], "result": "지문 교체 완료 (18자)"}))
        events = await recv_until(ws, "turn_end")
        texts = [e["text"] for e in events if e["type"] == "assistant_text"]
        check("model saw tool result", any("도구 결과 확인" in t and "지문 교체 완료" in t for t in texts), str(texts)[:200])
        check("turn_end clean", events[-1]["error"] is None, str(events[-1]))

        # 3. 스키마 검증 경계: 잘못된 입력은 클라이언트에 도달하지 않고 모델에 거부 반환
        await ws.send(json.dumps({
            "type": "chat", "req_id": "t2", "content": "검증테스트",
            "provider_id": prov["id"], "active_tab": "basic", "tab_context": "{}"}))
        events = await recv_until(ws, "turn_end")
        tool_calls = [e for e in events if e["type"] == "tool_call"]
        texts = [e["text"] for e in events if e["type"] == "assistant_text"]
        check("invalid tool never reaches client", len(tool_calls) == 0, str(tool_calls)[:150])
        check("model told about rejection", any("거부됨" in t for t in texts), str(texts)[:200])
        check("turn survives bad input", events[-1]["type"] == "turn_end" and events[-1]["error"] is None, str(events[-1]))

        # 4. 일반 대화 (도구 없음)
        await ws.send(json.dumps({
            "type": "chat", "req_id": "t3", "content": "그냥 인사",
            "provider_id": prov["id"], "active_tab": "basic", "tab_context": ""}))
        events = await recv_until(ws, "turn_end")
        check("plain text turn", any(e["type"] == "assistant_text" for e in events), str(events)[:150])

    await ad.delete(f"/admin/settings/ai/providers/{prov['id']}")
    await ad.aclose()
    await cd.aclose()
    print(f"\n=== {ok} passed, {fail} failed ===")
    sys.exit(1 if fail else 0)


asyncio.run(main())

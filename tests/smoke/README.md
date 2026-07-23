# 스모크 테스트 (라이브 스택 E2E)

로컬에서 `docker compose up -d` 후 실행합니다. 각 스크립트는 시드 데모 계정을 사용하며 멱등합니다.

```bash
python3 test_core.py            # 핵심 흐름: 응시→4개 언어 채점→행동기록→리뷰 (31)
python3 test_staff.py           # 스태프 체험 응시/초기화 (13)
python3 test_ai_turns.py        # AI 질문 한도/환불 (15)
python3 test_state_restore.py   # 에디터 상태 저장/복원 (7)

# 다중 LLM 공급자 E2E — 모의 서버 필요:
python3 mock_llm.py &           # :18001에 OpenAI 호환 모의 서버
# 게이트웨이 IP 확인: docker network inspect harnesser_default -f '{{(index .IPAM.Config 0).Gateway}}'
python3 test_ai_providers.py "http://<gateway>:18001/v1"   # (24)
```

```bash
# AI 채팅 WebSocket E2E — api 컨테이너 내부에서 실행 (websockets 의존성 내장):
docker cp test_ai_ws.py harnesser-api-1:/tmp/ && docker exec harnesser-api-1 python3 /tmp/test_ai_ws.py "http://<gateway>:18001/v1"   # (18)
```

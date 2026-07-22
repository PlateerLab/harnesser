# Harnesser

**코딩 테스트 & AI 활용 평가 플랫폼** — 문제 출제부터 응시, 샌드박스 채점, AI 협업 테스트, 전 과정 행동 기록과 LLM 자동평가까지 하나의 스택으로 제공합니다.

```
git clone https://github.com/PlateerLab/harnesser.git
cd harnesser
docker compose up -d --build
# → http://localhost:3000
```

## 핵심 기능

### 1. 코딩 테스트
- **Python 3 · C++17 · Java 21 · Go** 4개 언어 지원 (Programmers 스타일)
- Monaco 에디터(셀프호스팅, 폐쇄망 OK) + 예시 테스트 **실행** / 전체 **제출** 채점
- 샌드박스 채점 워커: 비특권 사용자 강등 + rlimit(CPU/메모리/프로세스/파일) + 언어별 시간 보정 계수
- 시험 단위 구성: 문제 N개 배정, 배점, 제한시간, 응시 가능 기간

### 2. AI 활용 테스트 (`ai_assisted` 모드)
- 응시 화면에 AI 채팅 패널 제공 — 응시자는 LLM과 대화하며 코드를 작성/붙여넣기
- OpenAI 호환 엔드포인트면 무엇이든 연결 가능 (OpenAI / Anthropic compat / vLLM / 사내 게이트웨이)
- **모든 대화 턴이 서버에 기록**되어 평가에 활용

### 3. 전 과정 행동 기록 & 평가 뷰
응시 중 발생하는 모든 행동이 append-only 이벤트 로그로 남습니다:

| 이벤트 | 내용 |
|---|---|
| `code_snapshot` | 20초 주기 + 실행/제출 시점의 코드 스냅샷 |
| `paste` | 붙여넣기 (문자 수 + 내용) |
| `focus_lost/gained` | 화면 이탈/복귀 |
| `run/submit_*` | 실행·제출 요청과 결과 |
| `ai_message` | AI 대화 턴 |

평가자 리뷰 뷰 제공:
- **타임라인** — 전체 이벤트를 필터링(이탈/붙여넣기, 실행/제출, AI, 스냅샷)해 시간축으로 열람
- **코드 재생** — 스냅샷 슬라이더/자동 재생 + 직전 스냅샷과의 diff 뷰
- **제출 기록** — 제출별 코드/컴파일 출력/테스트별 결과 (히든 테스트 포함)
- **AI 대화** — 전체 트랜스크립트
- **LLM 자동평가** — 정답성/코드 품질/풀이 과정/AI 활용도 + 무결성 플래그를 구조화 점수로 생성, 평가자 수동 평가와 병행

## 아키텍처

```
┌──────────┐   /api rewrite   ┌──────────┐   LPUSH    ┌───────────┐
│   web    │ ───────────────► │   api    │ ─────────► │   judge   │
│ Next.js  │                  │ FastAPI  │   Redis    │ worker    │
└──────────┘                  └────┬─────┘ ◄───────── │ (sandbox) │
                                   │      콜백(HTTP)   └───────────┘
                              PostgreSQL
```

| 서비스 | 스택 | 역할 |
|---|---|---|
| `web` | Next.js 15, Tailwind v4, Monaco | 응시/관리자/리뷰 UI |
| `api` | FastAPI, SQLAlchemy(async), PostgreSQL | 인증(JWT 쿠키), CRUD, 이벤트 기록, AI SSE 프록시, 자동평가 |
| `judge` | Python + gcc/openjdk-21/go 툴체인 | Redis 큐 소비, rlimit 샌드박스 채점, 결과 콜백 |
| `postgres` / `redis` | 16-alpine / 7-alpine | 저장소 / 채점 큐 |

## 설정

```bash
cp .env.example .env   # 필요 시 수정 (없어도 기본값으로 기동)
```

| 변수 | 설명 |
|---|---|
| `AI_BASE_URL` / `AI_API_KEY` | OpenAI 호환 엔드포인트. 비우면 AI 채팅/자동평가만 비활성화 |
| `AI_CHAT_MODEL` / `AI_EVAL_MODEL` | 응시자 채팅용 / 자동평가용 모델 |
| `JWT_SECRET` / `INTERNAL_TOKEN` | 운영 배포 시 반드시 교체 (`openssl rand -hex 32`) |
| `SEED_DEMO_DATA` | 최초 기동 시 데모 계정/문제/시험 생성 (기본 true) |
| `JUDGE_CONCURRENCY` | 채점 워커 동시 실행 수 (기본 2) |

### 데모 계정 (시드)

| 역할 | 이메일 | 비밀번호 |
|---|---|---|
| 관리자 | `admin@harnesser.dev` | `admin1234` |
| 평가자 | `evaluator@harnesser.dev` | `eval1234` |
| 응시자 | `candidate@harnesser.dev` | `cand1234` |

시드에는 데모 문제 3개와 시험 2개(일반/AI 활용)가 포함되어 바로 응시 → 리뷰 흐름을 확인할 수 있습니다.

## 운영 노트

- **채점 격리**: 제출 코드는 judge 컨테이너 안에서 `sandbox` 비특권 사용자로 강등되어 CPU/파일/프로세스 rlimit 하에 실행됩니다. JVM/Go는 가상 주소 공간 특성상 `-Xmx`/`GOMEMLIMIT`로 메모리를 제어합니다. 더 강한 격리(네트워크 네임스페이스, per-submission 컨테이너)는 로드맵 참고.
- **채점 스케일아웃**: `docker compose up -d --scale judge=4`
- **스키마**: 초기 버전은 기동 시 `create_all` 방식입니다. 스키마 변경이 시작되면 Alembic 마이그레이션 도입을 권장합니다.

## 로드맵

- [ ] 채점 네트워크 완전 차단 (netns) 및 per-submission 격리 강화
- [ ] Alembic 마이그레이션
- [ ] 문제 대량 등록(가져오기/내보내기), 태그·검색
- [ ] 응시 화면 웹캠/추가 프록터링 옵션
- [ ] 리포트 내보내기 (PDF)

## License

MIT © Plateer Lab

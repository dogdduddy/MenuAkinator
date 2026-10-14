# 메뉴 아키네이터

사용자가 떠올린 음식 메뉴를 질문 몇 개로 맞히는 정적 웹앱. 서버 없이 브라우저에서만 동작한다.

**직접 해보고 실사용 테스트를 하려면 → [TESTING.md](TESTING.md)**

## 명령

| 명령 | 설명 |
|---|---|
| `npm run data` | `data/*.csv` 검증 → `src/generated/data.json` 생성 + 데이터 분석 출력 |
| `npm test` | 엔진 단위 테스트 |
| `npm run sim` | 시뮬레이터 리포트 (현재 설정. `reports/`에 저장, 직전 리포트와 비교) |
| `npm run experiments` | 비교 실험 (E1 데이터 버전 비교 · E2 고정 예산 평가 · E3 α/실수율 × 임계값) |
| `npm run dev` | 개발 서버 (같은 Wi-Fi의 폰에서 접속 가능). 게임 결과를 `results/results.jsonl`에 저장 |
| `npm run analyze` | 실사용 결과 분석 (`-- 파일...`로 내려받은 JSON도 합쳐서) |
| `npm run build` | 정적 빌드 (`dist/`) |

시뮬레이터 옵션: `--n 40` (A 판수/메뉴) `--nr 15` (B 판수/메뉴) `--seed 1` `--alpha 1` `--slip 0.05` `--threshold 0.6` `--soft 0.5`
`--only A0,A,B1_0.2,B4,T` (일부만, 리포트 저장 안 함) `--data <json>` (엔진 표) `--user-data <json>` (가상 사용자 표. 메뉴·질문 id로 맞춤)

시뮬레이터 시나리오
- **A0 모델 일치 검증**: 예/아니요만, 실수 0%, α 1, 실수율 0 — 엔진 가정과 가상 사용자가 완전히 같으므로 보정오차가 0에 가까워야 한다. 아니면 계산·집계 버그
- **A 기본**: 표대로 답하되 5%는 실수. 상한선이 아니다 (사람이 표보다 일관되면 더 높게 나온다)
- **B1~B5**: 인식 차이, 신중형 답변, 상관 응답, 목록에 없는 메뉴, 실수율 — 스트레스 테스트
- 데이터를 바꾸면 가상 사용자도 같이 바뀐다. 데이터 개선만 보려면 `npm run experiments`의 E1처럼 사용자 표를 고정해서 비교

## 엔진 기본 설정 (`src/engine/types.ts`)

| 설정 | 값 | 근거 |
|---|---|---|
| 추측 임계값 | 0.6 | 실수율 0.05와 함께 E3에서 선택 |
| 실수율 (slipRate) | 0.05 | 사람이 5%는 반대로 답한다고 가정. 명확한 칸에 대한 과신을 줄임. 실사용 "가설 1"로 재조정 |
| α (evidenceWeight) | 1 | 고정 예산 평가(E2)에서 α를 낮춰도 추론 성능이 좋아지지 않음 |
| 시간대 가중치 | OFF | 임의로 떠올린 메뉴에 식사 시간대 분포가 적용된다는 근거 없음. 실사용 "가설 5"로 검증 |
| 최소/최대 질문 | 3 / 15 | |

## 데이터 수정 흐름

1. `data/matrix.csv`를 스프레드시트로 열어 수정 (행 = 메뉴, 열 = 질문, 값 = "이 메뉴를 떠올린 사람이 '예'라고 답할 확률")
2. `npm run data` — 오류가 있으면 JSON을 만들지 않는다. 구분이 어려운 메뉴 쌍, 중복 의심 질문을 확인
3. `npm run sim` — 맨 아래 "직전 리포트 대비"로 개선 여부 확인

- `menus.csv`의 시간대 가중치는 0.5~2 범위 (1 = 보통)
- `questions.csv`의 `group`은 의미가 비슷한 질문 묶음 (검수·상관 응답 시뮬레이션용), `scope`는 broad/fine
- 메뉴 단위: 대표 메뉴명 하나. 변형은 `aliases`(`|` 구분)로 통합. 이름이 다르고 질문 2개 이상에서 답이 강하게 갈릴 때만 분리

## 결과 저장 (ResultSink)

게임이 끝나면 `GameResult`를 `ResultSink`들에 넘긴다 (`src/sink/`).

- 시작할 때 `GameStart`, 끝날 때 `GameResult`를 저장 (완료율 = 결과 / 시작). 기록마다 데이터·엔진 버전, 엔진 설정, 테스트 모드(자유/지정 메뉴), 정답 확인 경로가 남는다
- 개발 서버: `DevFileSink`(→ `results/results.jsonl`) + `LocalStorageSink`(백업)
- 배포본: `LocalStorageSink`만. 숨김 메뉴(제목 5번 탭)에서 JSON으로 내려받기
- 나중에 서버를 붙일 때는 `DevFileSink`처럼 HTTP로 보내는 Sink를 추가하면 된다

## 주의

- **엔진 점수는 정답 확률이 아니다.** 나이브 베이즈는 질문 간 독립을 가정해 과신하기 쉽다. 시뮬레이터의 "확신도 보정" 표 참고.
- **질문 선택은 예/아니요 2분기 근사**다. 질문마다 '모르겠어요' 비율이 다르면 최적 순위가 달라질 수 있다.
- **시뮬레이터 정확도는 실제 사용자 정확도가 아니다.** A는 엔진과 같은 표로 사용자를 만들므로 상한선이다.

## 구조

```
data/            원본 CSV (검수 대상). data/versions/ 에 버전별 스냅샷 (실험 비교용)
scripts/         build-data, simulate, experiments, analyze-results, lib/(CSV 로더·데이터 분석·시뮬레이션·지표)
src/engine/      순수 TS 엔진 (UI·브라우저 API 의존 없음)
src/sink/        결과 저장 (ResultSink 인터페이스, LocalStorageSink, DevFileSink)
src/ui/          Preact 화면
vite.config.ts   개발 서버 전용 결과 파일 저장 플러그인 (POST /__results)
tests/           Vitest
reports/         시뮬레이터 리포트 JSON
```

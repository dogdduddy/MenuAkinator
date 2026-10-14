// 시뮬레이터와 실사용 결과 분석이 함께 쓰는 지표.
// 모든 비율은 이름에 분모를 드러낸다: …PerGame = 전체 게임, …PerGuessed = 추측을 한 번 이상 한 게임, …PerGuess = 추측 1회.

/** 실사용 테스트 목표 (검증된 기준이 아니라 실험 출발점) */
export const TARGETS = {
  firstGuessAccPerGame: 0.7,
  avgQuestions: 10,
  completionRate: 0.8,
};

export interface GuessRecord {
  menuId: string;
  score: number;
  afterQuestions: number;
  correct: boolean;
}

export interface PlayRecord {
  guesses: GuessRecord[];
  /** 엔진의 추측으로 맞혔는지 (사용자가 후보에서 고르거나 검색해서 알려준 경우는 false) */
  solved: boolean;
  questionCount: number;
  /** 후보 화면에서 보여준 상위 메뉴 (없으면 빈 배열) */
  finalTop: string[];
  /** 정답 메뉴 id. 목록에 없으면 null */
  target: string | null;
}

export interface CalibrationBin {
  range: string;
  /** 이 구간에 든 추측 수 (분모) */
  n: number;
  /** 구간 안 추측들의 평균 엔진 점수 */
  meanScore: number;
  /** 구간 안 추측 중 실제 정답 비율 */
  accuracy: number;
}

export interface Summary {
  games: number;
  /** 추측을 한 번이라도 한 게임 / 전체 게임 */
  guessRatePerGame: number;
  /** 첫 추측이 정답인 게임 / 전체 게임 (추측 없이 끝난 게임은 실패로 셈) */
  firstGuessAccPerGame: number;
  /** 첫 추측이 정답인 게임 / 추측을 한 게임 */
  firstGuessAccPerGuessed: number;
  /** 엔진 추측으로 맞힌 게임 / 전체 게임 (재추측 포함, 후보 선택·검색 제외) */
  solvedByGuessPerGame: number;
  /** 엔진은 못 맞혔지만 공개한 후보 3개 안에 정답이 있던 게임 / 전체 게임 — 엔진 성공 아님, 참고용 */
  inCandidatesPerGame: number;
  /** 정답을 알 수 없는 게임(목록에 없음) / 전체 게임 */
  noTargetPerGame: number;
  avgQuestionsAll: number;
  avgQuestionsSolved: number;
  avgQuestionsUnsolved: number;
  /** 게임당 추측 횟수 */
  guessesPerGame: number;
  /** 점수 0.9 이상 추측 중 틀린 비율 (분모: 0.9 이상 추측 수) */
  highConfWrongPerHighConfGuess: number;
  highConfGuesses: number;
  /** 0.9 이상 확신으로 한 번이라도 틀린 게임 / 전체 게임 */
  highConfWrongGamePerGame: number;
  /** 틀린 추측들의 평균 점수 */
  wrongGuessMeanScore: number;
  calibration: CalibrationBin[];
}

const CAL_BINS: [number, number][] = [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 0.95], [0.95, 0.99], [0.99, 1.0001]];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const rate = (num: number, den: number) => (den ? num / den : NaN);

export function summarize(records: PlayRecord[]): Summary {
  const n = records.length;
  const guesses = records.flatMap((r) => r.guesses);
  const wrong = guesses.filter((g) => !g.correct);
  const high = guesses.filter((g) => g.score >= 0.9);
  const guessed = records.filter((r) => r.guesses.length > 0);
  const solved = records.filter((r) => r.solved);
  const unsolved = records.filter((r) => !r.solved);
  return {
    games: n,
    guessRatePerGame: rate(guessed.length, n),
    firstGuessAccPerGame: rate(records.filter((r) => r.guesses[0]?.correct).length, n),
    firstGuessAccPerGuessed: rate(guessed.filter((r) => r.guesses[0].correct).length, guessed.length),
    solvedByGuessPerGame: rate(solved.length, n),
    inCandidatesPerGame: rate(unsolved.filter((r) => r.target !== null && r.finalTop.includes(r.target)).length, n),
    noTargetPerGame: rate(records.filter((r) => r.target === null).length, n),
    avgQuestionsAll: mean(records.map((r) => r.questionCount)),
    avgQuestionsSolved: mean(solved.map((r) => r.questionCount)),
    avgQuestionsUnsolved: mean(unsolved.map((r) => r.questionCount)),
    guessesPerGame: rate(guesses.length, n),
    highConfGuesses: high.length,
    highConfWrongPerHighConfGuess: rate(high.filter((g) => !g.correct).length, high.length),
    highConfWrongGamePerGame: rate(records.filter((r) => r.guesses.some((g) => !g.correct && g.score >= 0.9)).length, n),
    wrongGuessMeanScore: mean(wrong.map((g) => g.score)),
    calibration: CAL_BINS.map(([lo, hi]) => {
      const inBin = guesses.filter((g) => g.score >= lo && g.score < hi);
      return {
        range: `${lo.toFixed(2)}–${Math.min(hi, 1).toFixed(2)}`,
        n: inBin.length,
        meanScore: mean(inBin.map((g) => g.score)),
        accuracy: rate(inBin.filter((g) => g.correct).length, inBin.length),
      };
    }).filter((b) => b.n > 0),
  };
}

/**
 * 확신도 보정 오차: 구간별 |평균 점수 − 실제 정답률|을 추측 수로 가중 평균 (ECE).
 * 엔진 가정과 사용자가 일치하면 0에 가까워야 한다.
 */
export function calibrationError(bins: CalibrationBin[]): number {
  const total = bins.reduce((s, b) => s + b.n, 0);
  return total ? bins.reduce((s, b) => s + b.n * Math.abs(b.meanScore - b.accuracy), 0) / total : NaN;
}

export const pct = (x: number) => (Number.isNaN(x) ? '   -  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
export const num = (x: number, d = 1) => (Number.isNaN(x) ? '-' : x.toFixed(d));

/** 지표 정의 (리포트 하단에 출력) */
export const METRIC_DEFINITIONS = [
  '첫추측(게임)   = 첫 추측이 정답인 게임 / 전체 게임. 추측 없이 끝난 게임은 실패',
  '첫추측(추측)   = 첫 추측이 정답인 게임 / 추측을 한 번 이상 한 게임',
  '추측률         = 추측을 한 번 이상 한 게임 / 전체 게임',
  '추측성공       = 엔진 추측으로 맞힌 게임(재추측 포함) / 전체 게임. 후보 선택·검색 입력은 제외',
  '후보안         = 엔진은 못 맞혔지만 공개한 후보 3개에 정답이 있던 게임 / 전체 게임 (엔진 성공 아님)',
  '평균Q          = 모든 게임의 질문 수 평균 (맞힌·못 맞힌 게임 모두 포함)',
  '고확신오답(추측) = 점수 ≥0.9 추측 중 틀린 비율 (분모: 점수 ≥0.9 추측 수)',
  '고확신오답(게임) = 점수 ≥0.9로 한 번이라도 틀린 게임 / 전체 게임',
  '보정오차(ECE)  = 점수 구간별 |평균 점수 − 실제 정답률|의 추측 수 가중 평균. 0이면 점수 = 정답 확률',
];

/**
 * 관측된 "반대 답변 비율"에서 엔진 slipRate를 추정한다.
 *
 * 엔진 모델: 사람이 표대로 P(예)=p 로 답한 뒤 s 확률로 뒤집는다 → P(예) = (1−s)·p + s·(1−p).
 * 표의 값이 p일 때 "표와 반대 방향" 답이 나올 확률은 q + s·(1 − 2q)  (q = min(p, 1−p), 표 자체의 불확실성).
 * 예: p=0.98, s=0.05 → 0.02 + 0.05·0.96 = 0.068. 관측된 반대 비율 6.8%를 그대로 slipRate에 넣으면 중복 반영이 된다.
 *
 * 여러 칸의 답변을 모아 기대 반대 비율 = mean(q) + s·(1 − 2·mean(q)) 로 놓고 s를 푼다 (적률 추정).
 * @param tableQs 각 답변이 걸린 칸의 q = min(p, 1−p)
 * @param contradictions 그중 표와 반대로 답한 수
 */
export function estimateSlip(tableQs: number[], contradictions: number): { observed: number; tableBaseline: number; slip: number } {
  const n = tableQs.length;
  if (n === 0) return { observed: NaN, tableBaseline: NaN, slip: NaN };
  const observed = contradictions / n;
  const tableBaseline = tableQs.reduce((a, b) => a + b, 0) / n;
  const slip = Math.min(0.5, Math.max(0, (observed - tableBaseline) / (1 - 2 * tableBaseline)));
  return { observed, tableBaseline, slip };
}

/** 이항분포 꼬리 확률 P(X ≥ k | n, rate) — 우연히 이만큼 반대 답이 나올 확률 */
export function binomialTail(n: number, k: number, rate: number): number {
  let total = 0;
  let coef = 1; // C(n, i)
  for (let i = 0; i <= n; i++) {
    if (i > 0) coef = (coef * (n - i + 1)) / i;
    if (i >= k) total += coef * rate ** i * (1 - rate) ** (n - i);
  }
  return Math.min(1, total);
}

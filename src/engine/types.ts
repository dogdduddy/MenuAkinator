export type Answer = 'yes' | 'probably' | 'dunno' | 'probablyNot' | 'no';
export const ANSWERS: readonly Answer[] = ['yes', 'probably', 'dunno', 'probablyNot', 'no'];

export type TimeSlot = 'morning' | 'lunch' | 'dinner' | 'latenight';
export const TIME_SLOTS: readonly TimeSlot[] = ['morning', 'lunch', 'dinner', 'latenight'];

export interface Menu {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  timeWeights: Record<TimeSlot, number>;
}

export interface Question {
  id: string;
  text: string;
  group: string;
  scope: 'broad' | 'fine';
}

export interface GameData {
  version: string;
  menus: Menu[];
  questions: Question[];
  /** matrix[menuIndex][questionIndex] = P(예 | 이 메뉴를 떠올림), 0.02~0.98로 클램프된 값 */
  matrix: number[][];
}

export interface EngineConfig {
  /** 1위 점수가 이 값 이상이면 추측 */
  guessThreshold: number;
  /** 이 개수만큼 질문하기 전에는 추측하지 않음 */
  minQuestions: number;
  /** 이 개수만큼 질문하면 후보 공개 */
  maxQuestions: number;
  /** 아마도·아마 아니요의 완화 계수 (휴리스틱). 1이면 예·아니요와 같고 0이면 업데이트 없음 */
  softFactor: number;
  /** likelihood 지수 α. 1보다 작으면 증거를 덜 믿음 (질문 간 의존성으로 인한 과신 완화용) */
  evidenceWeight: number;
  /** 답변 실수율. 사람이 이 확률로 반대로 답한다고 보고 likelihood를 완화한다. 0이면 표의 값 그대로 */
  slipRate: number;
  useTimePrior: boolean;
}

export const DEFAULT_CONFIG: EngineConfig = {
  // 실수율 0.05와 함께 조정한 값 (npm run experiments의 E3 참고). 실사용 보정표로 다시 확인할 것
  guessThreshold: 0.6,
  minQuestions: 3,
  maxQuestions: 15,
  softFactor: 0.5,
  evidenceWeight: 1,
  // 사람이 5%는 반대로 답한다고 가정. 정의형 칸(0.98/0.02)에 대한 과신을 줄인다. 실사용 '가설 1' 측정값으로 조정
  slipRate: 0.05,
  // 임의로 떠올린 메뉴를 맞히는 게임이라 실제 식사 시간대 분포가 그대로 적용된다고 보기 어렵다. 실사용 로그로 검증 전까지 OFF.
  useTimePrior: false,
};

/** 엔진 로직이 바뀌면 올린다. 결과 기록에 남아 버전별 비교에 쓰인다 */
export const ENGINE_VERSION = '1.1.0';

export type GameEvent =
  | { type: 'answer'; questionId: string; answer: Answer }
  | { type: 'reject'; menuId: string };

/**
 * 주의: score는 엔진의 "확신 점수"(posterior)이지 실제 정답 확률이 아니다.
 * 나이브 베이즈는 질문 간 독립을 가정하므로 실제보다 과신하기 쉽다.
 */
export interface Ranked {
  menuId: string;
  score: number;
}

export type NextAction =
  | { type: 'ask'; questionId: string }
  | { type: 'guess'; menuId: string; score: number }
  | { type: 'giveUp'; top: Ranked[] };

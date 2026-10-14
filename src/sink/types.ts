import type { EngineConfig, GameEvent, TimeSlot } from '../engine/index.ts';

export interface GuessLog {
  menuId: string;
  /** 추측 당시 엔진 점수. 정답 확률이 아니라 확신 점수 */
  score: number;
  afterQuestions: number;
  correct: boolean;
}

/**
 * 테스트 모드.
 * free: 아무 메뉴나 자유롭게 떠올림 (메뉴 범위·실제 경험 확인)
 * assigned: 목록에서 무작위로 정해준 메뉴를 떠올림 (엔진·질문 품질 확인. 정답을 항상 앎)
 */
export type PlayMode = 'free' | 'assigned';

/** 정답을 어떻게 알게 됐는지 */
export type FinalSource =
  | 'guess' // 엔진 추측이 맞음 (사용자가 "맞아요")
  | 'candidates' // 후보 3개 중 사용자가 고름 — 엔진 성공 아님
  | 'search' // 메뉴 목록 검색으로 사용자가 알려줌 — 엔진 성공 아님
  | 'notInList' // 목록에 없는 메뉴
  | 'assigned'; // 지정 메뉴 모드에서 엔진이 못 맞혀 지정 메뉴로 기록

interface RecordBase {
  schema: 1;
  /** 이 브라우저를 구분하는 임의 id (개인정보 아님) */
  deviceId: string;
  /** 이 브라우저에서 몇 번째로 시작한 게임인지. 1이면 첫 플레이 */
  playIndex: number;
  mode: PlayMode;
  assignedMenuId?: string;
  startedAt: string;
  timeSlot: TimeSlot;
  dataVersion: string;
  engineVersion: string;
  config: EngineConfig;
}

/** 게임 시작 기록. 끝내지 않은 게임도 남으므로 완료율 = 결과 수 / 시작 수 */
export interface GameStart extends RecordBase {
  kind: 'start';
}

/** 게임 한 판의 결과. 나중에 서버로 보낼 때도 이 형태를 그대로 쓴다. */
export interface GameResult extends RecordBase {
  kind: 'result';
  events: GameEvent[];
  guesses: GuessLog[];
  endedBy: 'guessCorrect' | 'maxQuestions' | 'userAskedCandidates';
  /** 정답 메뉴. 목록에 없으면 null */
  finalMenuId: string | null;
  finalSource: FinalSource;
  notInList: boolean;
  notInListName?: string;
  /** 엔진의 추측으로 맞혔는지 (후보 선택·검색은 false) */
  solved: boolean;
  firstGuessCorrect: boolean;
  questionCount: number;
  /** "이전 질문으로"를 누른 횟수. 되돌리기로 취소된 추측은 guesses에 남지 않는다 */
  undoCount: number;
  /** 후보 화면에서 보여준 상위 메뉴 */
  finalTop: string[];
  timestamp: string;
  durationMs: number;
}

export type GameRecord = GameStart | GameResult;

export interface ResultSink {
  /** 화면에 보여줄 이름 */
  readonly label: string;
  save(record: GameRecord): Promise<void>;
}

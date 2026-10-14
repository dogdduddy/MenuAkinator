import { likelihood } from './likelihood.ts';
import { prior } from './prior.ts';
import { selectQuestion } from './select.ts';
import type {
  Answer, EngineConfig, GameData, GameEvent, NextAction, Ranked, TimeSlot,
} from './types.ts';

/**
 * 게임 상태는 이벤트 기록(답변, 추측 거절)뿐이다. 점수는 매번 처음부터 다시 계산한다.
 * 그래서 되돌리기는 기록을 자르는 것으로 끝나고, 같은 기록이면 항상 같은 결과가 나온다.
 */
export interface GameState {
  timeSlot: TimeSlot;
  events: readonly GameEvent[];
}

export interface Posterior {
  /** 메뉴 인덱스별 확신 점수 (합 1). 거절된 메뉴는 0 */
  scores: Float64Array;
  askedIdx: Set<number>;
  rejectedIdx: Set<number>;
  questionCount: number;
}

interface Index {
  menu: Map<string, number>;
  question: Map<string, number>;
}
const indexCache = new WeakMap<GameData, Index>();
export function indexOf(data: GameData): Index {
  let idx = indexCache.get(data);
  if (!idx) {
    idx = {
      menu: new Map(data.menus.map((m, i) => [m.id, i])),
      question: new Map(data.questions.map((q, i) => [q.id, i])),
    };
    indexCache.set(data, idx);
  }
  return idx;
}

export function newGame(timeSlot: TimeSlot): GameState {
  return { timeSlot, events: [] };
}

export function answer(state: GameState, questionId: string, a: Answer): GameState {
  return { ...state, events: [...state.events, { type: 'answer', questionId, answer: a }] };
}

export function rejectGuess(state: GameState, menuId: string): GameState {
  return { ...state, events: [...state.events, { type: 'reject', menuId }] };
}

/**
 * 직전 질문으로 되돌린다: 마지막 답변과 그 뒤의 모든 이벤트(추측 거절 포함)를 지운다.
 * 답을 바꾸면 그 추측 자체가 나오지 않을 수 있으므로 거절도 함께 취소하는 것이 맞다.
 */
export function undo(state: GameState): GameState {
  let i = state.events.length - 1;
  while (i >= 0 && state.events[i].type !== 'answer') i--;
  return { ...state, events: state.events.slice(0, Math.max(i, 0)) };
}

export function computePosterior(data: GameData, config: EngineConfig, state: GameState): Posterior {
  const idx = indexOf(data);
  const n = data.menus.length;
  const p0 = prior(data, config.useTimePrior, state.timeSlot);
  const logS = new Float64Array(n);
  for (let i = 0; i < n; i++) logS[i] = Math.log(p0[i]);

  const askedIdx = new Set<number>();
  const rejectedIdx = new Set<number>();
  let questionCount = 0;

  for (const e of state.events) {
    if (e.type === 'reject') {
      const mi = idx.menu.get(e.menuId);
      if (mi !== undefined) rejectedIdx.add(mi);
      continue;
    }
    const qi = idx.question.get(e.questionId);
    if (qi === undefined) continue;
    askedIdx.add(qi);
    questionCount++;
    for (let i = 0; i < n; i++) {
      const l = likelihood(data.matrix[i][qi], e.answer, config.softFactor, config.slipRate);
      if (l !== null) logS[i] += config.evidenceWeight * Math.log(l);
    }
  }

  // 사용자가 명시적으로 아니라고 한 메뉴만 하드 제외한다. 일반 답변으로는 제외하지 않는다.
  let max = -Infinity;
  for (let i = 0; i < n; i++) if (!rejectedIdx.has(i) && logS[i] > max) max = logS[i];
  const scores = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (rejectedIdx.has(i)) continue;
    scores[i] = Math.exp(logS[i] - max);
    sum += scores[i];
  }
  if (sum > 0) for (let i = 0; i < n; i++) scores[i] /= sum;

  return { scores, askedIdx, rejectedIdx, questionCount };
}

export function ranked(data: GameData, post: Posterior, k = Infinity): Ranked[] {
  const out: Ranked[] = [];
  post.scores.forEach((score, i) => {
    if (!post.rejectedIdx.has(i)) out.push({ menuId: data.menus[i].id, score });
  });
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, k);
}

export function nextAction(
  data: GameData,
  config: EngineConfig,
  state: GameState,
  post: Posterior = computePosterior(data, config, state),
): NextAction {
  const top = ranked(data, post, 3);
  if (top.length === 0) return { type: 'giveUp', top };

  if (post.questionCount >= config.minQuestions && top[0].score >= config.guessThreshold) {
    return { type: 'guess', menuId: top[0].menuId, score: top[0].score };
  }
  if (post.questionCount >= config.maxQuestions) return { type: 'giveUp', top };

  const qi = selectQuestion(data, post.scores, post.askedIdx, config.evidenceWeight, config.slipRate);
  if (qi < 0) return { type: 'giveUp', top };
  return { type: 'ask', questionId: data.questions[qi].id };
}

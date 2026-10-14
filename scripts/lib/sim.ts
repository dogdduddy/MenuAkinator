import {
  answer as applyAnswer, clampP, computePosterior, indexOf, newGame, nextAction, rejectGuess,
  type Answer, type EngineConfig, type GameData, type TimeSlot,
} from '../../src/engine/index.ts';
import type { PlayRecord } from './metrics.ts';

export type Rng = () => number;

/** 시드 고정 난수 (mulberry32) */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleIndex(weights: ArrayLike<number>, rng: Rng): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** 가상 사용자의 답변 성향 */
export interface UserStyle {
  /** 예/아니요를 뒤집을 확률 (단순 실수) */
  noise: number;
  /** 예→아마도, 아니요→아마 아니요로 답할 확률 */
  softRate: number;
  /** 모르겠어요로 답할 확률 */
  dunnoRate: number;
  /** >0이면 게임마다 질문 group별로 −s/0/+s 인식 편향을 뽑아 같은 group 질문에 공통 적용 (상관 응답) */
  groupShift: number;
}

export const BASIC_STYLE: UserStyle = { noise: 0.05, softRate: 0, dunnoRate: 0, groupShift: 0 };

export interface SimGame extends PlayRecord {
  answers: { questionId: string; answer: Answer }[];
  endedBy: 'guessCorrect' | 'giveUp';
}

/**
 * 한 판 진행.
 * @param userRow 사용자가 떠올린 메뉴에 대한 "사용자 머릿속" P(예) 벡터 (엔진 표와 다를 수 있음)
 * @param target 정답 메뉴 id. 엔진 데이터에 없는 메뉴(목록에 없음)도 가능
 */
export function playGame(
  data: GameData,
  config: EngineConfig,
  slot: TimeSlot,
  userRow: number[],
  target: string,
  style: UserStyle,
  rng: Rng,
): SimGame {
  const qIdx = indexOf(data).question;
  const shiftOf = new Map<string, number>();
  if (style.groupShift > 0) {
    for (const q of data.questions) {
      if (shiftOf.has(q.group)) continue;
      const r = rng();
      shiftOf.set(q.group, r < 0.25 ? -style.groupShift : r < 0.5 ? style.groupShift : 0);
    }
  }

  let state = newGame(slot);
  const rec: SimGame = { guesses: [], solved: false, questionCount: 0, finalTop: [], target, answers: [], endedBy: 'giveUp' };

  for (let step = 0; step < 500; step++) {
    const post = computePosterior(data, config, state);
    const act = nextAction(data, config, state, post);
    if (act.type === 'ask') {
      const qi = qIdx.get(act.questionId)!;
      const p = clampP(userRow[qi] + (shiftOf.get(data.questions[qi].group) ?? 0));
      let yes = rng() < p;
      if (rng() < style.noise) yes = !yes;
      const r = rng();
      const a: Answer = r < style.dunnoRate ? 'dunno'
        : r < style.dunnoRate + style.softRate ? (yes ? 'probably' : 'probablyNot')
          : yes ? 'yes' : 'no';
      rec.answers.push({ questionId: act.questionId, answer: a });
      state = applyAnswer(state, act.questionId, a);
      rec.questionCount = post.questionCount + 1;
    } else if (act.type === 'guess') {
      const correct = act.menuId === target;
      rec.guesses.push({ menuId: act.menuId, score: act.score, afterQuestions: post.questionCount, correct });
      if (correct) {
        rec.solved = true;
        rec.endedBy = 'guessCorrect';
        return rec;
      }
      state = rejectGuess(state, act.menuId);
    } else {
      rec.finalTop = act.top.map((t) => t.menuId);
      return rec;
    }
  }
  throw new Error('게임이 끝나지 않음');
}

/** 칸마다 rate 확률로 한 단계 이동 (0.1↔0.5↔0.9). 사용자 인식이 데이터와 다른 상황 */
export function perturbMatrix(matrix: number[][], rate: number, rng: Rng): number[][] {
  return matrix.map((row) => row.map((v) => {
    if (rng() >= rate) return v;
    if (v >= 0.7 || v <= 0.3) return 0.5;
    return rng() < 0.5 ? 0.1 : 0.9;
  }));
}

/**
 * 가상 사용자 표를 엔진 데이터의 메뉴·질문 순서에 맞춰 가져온다 (id 기준).
 * 엔진이 묻는 질문이 사용자 표에 없으면 오류 — 평가용 사용자 표는 비교할 모든 질문을 포함해야 한다.
 */
export function loadUserMatrix(user: GameData, engine: GameData): number[][] {
  const um = new Map(user.menus.map((m, i) => [m.id, i]));
  const uq = new Map(user.questions.map((q, i) => [q.id, i]));
  const missingQ = engine.questions.filter((q) => !uq.has(q.id)).map((q) => q.id);
  const missingM = engine.menus.filter((m) => !um.has(m.id)).map((m) => m.id);
  if (missingQ.length || missingM.length) {
    throw new Error(`가상 사용자 표에 없는 항목 — 질문: ${missingQ.join(', ') || '-'} / 메뉴: ${missingM.join(', ') || '-'}`);
  }
  return engine.menus.map((m) => engine.questions.map((q) => user.matrix[um.get(m.id)!][uq.get(q.id)!]));
}

/** 메뉴 하나를 뺀 엔진 데이터 (목록에 없는 메뉴 테스트용) */
export function withoutMenu(data: GameData, menuIdx: number): GameData {
  return {
    ...data,
    menus: data.menus.filter((_, i) => i !== menuIdx),
    matrix: data.matrix.filter((_, i) => i !== menuIdx),
  };
}

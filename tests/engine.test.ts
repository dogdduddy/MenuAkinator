import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, answer, computePosterior, expectedEntropy, likelihood, newGame, nextAction,
  prior, rejectGuess, selectQuestion, timeSlotOf, undo, withSlip,
  type EngineConfig, type GameData, type Menu,
} from '../src/engine/index.ts';

const tw = (morning = 1, lunch = 1, dinner = 1, latenight = 1): Menu['timeWeights'] =>
  ({ morning, lunch, dinner, latenight });

// 국물(q_soup)·매움(q_spicy)·면(q_noodle)·무의미(q_flat)
const fixture: GameData = {
  version: 'test',
  menus: [
    { id: 'kimchi', name: '김치찌개', aliases: [], category: '한식', timeWeights: tw(1, 1, 1, 1) },
    { id: 'doenjang', name: '된장찌개', aliases: [], category: '한식', timeWeights: tw(1, 1, 1, 1) },
    { id: 'jeyuk', name: '제육볶음', aliases: [], category: '한식', timeWeights: tw(1, 1, 1, 1) },
    { id: 'naengmyeon', name: '냉면', aliases: [], category: '한식', timeWeights: tw(0.5, 1, 1, 2) },
  ],
  questions: [
    { id: 'q_soup', text: '국물?', group: 'soup', scope: 'broad' },
    { id: 'q_spicy', text: '매워?', group: 'taste', scope: 'broad' },
    { id: 'q_noodle', text: '면?', group: 'form', scope: 'broad' },
    { id: 'q_flat', text: '무의미', group: 'x', scope: 'fine' },
  ],
  matrix: [
    [0.9, 0.9, 0.1, 0.5],
    [0.9, 0.1, 0.1, 0.5],
    [0.1, 0.9, 0.1, 0.5],
    [0.9, 0.1, 0.9, 0.5],
  ],
};
const cfg: EngineConfig = { ...DEFAULT_CONFIG, useTimePrior: false };
const score = (s: ReturnType<typeof computePosterior>, id: string) =>
  s.scores[fixture.menus.findIndex((m) => m.id === id)];

describe('likelihood', () => {
  it('예·아니요는 p / 1−p', () => {
    expect(likelihood(0.9, 'yes', 0.5)).toBeCloseTo(0.9);
    expect(likelihood(0.9, 'no', 0.5)).toBeCloseTo(0.1);
  });
  it('아마도·아마 아니요는 0.5 쪽으로 완화', () => {
    expect(likelihood(0.9, 'probably', 0.5)).toBeCloseTo(0.7);
    expect(likelihood(0.9, 'probablyNot', 0.5)).toBeCloseTo(0.3);
    expect(likelihood(0.1, 'probably', 0.5)).toBeCloseTo(0.3);
  });
  it('모르겠어요는 업데이트하지 않음', () => {
    expect(likelihood(0.9, 'dunno', 0.5)).toBeNull();
  });
});

describe('prior / 시간대', () => {
  it('시간대 경계', () => {
    expect(timeSlotOf(new Date(2026, 0, 1, 4, 59))).toBe('latenight');
    expect(timeSlotOf(new Date(2026, 0, 1, 5, 0))).toBe('morning');
    expect(timeSlotOf(new Date(2026, 0, 1, 10, 0))).toBe('lunch');
    expect(timeSlotOf(new Date(2026, 0, 1, 15, 0))).toBe('dinner');
    expect(timeSlotOf(new Date(2026, 0, 1, 21, 0))).toBe('latenight');
  });
  it('ON이면 가중치 반영, OFF면 균등, 합은 1', () => {
    const on = prior(fixture, true, 'latenight');
    const off = prior(fixture, false, 'latenight');
    expect(on.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(on[3]).toBeCloseTo(2 / 5);
    expect([...off]).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});

describe('posterior', () => {
  it('답변하면 점수가 갱신되고 합은 1', () => {
    const s = answer(newGame('lunch'), 'q_soup', 'yes');
    const p = computePosterior(fixture, cfg, s);
    expect(p.scores.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(score(p, 'jeyuk')).toBeLessThan(score(p, 'kimchi'));
    expect(score(p, 'jeyuk')).toBeGreaterThan(0); // 하드 탈락 없음
  });
  it('모르겠어요는 점수를 바꾸지 않지만 질문 수에는 포함', () => {
    const base = computePosterior(fixture, cfg, newGame('lunch'));
    const p = computePosterior(fixture, cfg, answer(newGame('lunch'), 'q_soup', 'dunno'));
    expect([...p.scores]).toEqual([...base.scores]);
    expect(p.questionCount).toBe(1);
    expect(p.askedIdx.has(0)).toBe(true);
  });
  it('evidenceWeight(α) < 1 이면 같은 답변에도 덜 확신', () => {
    const s = answer(answer(newGame('lunch'), 'q_soup', 'yes'), 'q_spicy', 'yes');
    const full = computePosterior(fixture, cfg, s);
    const soft = computePosterior(fixture, { ...cfg, evidenceWeight: 0.5 }, s);
    expect(score(soft, 'kimchi')).toBeLessThan(score(full, 'kimchi'));
    expect(score(soft, 'kimchi')).toBeGreaterThan(0.25);
  });
  it('거절한 메뉴는 0점이고 나머지 합은 1', () => {
    const p = computePosterior(fixture, cfg, rejectGuess(newGame('lunch'), 'kimchi'));
    expect(score(p, 'kimchi')).toBe(0);
    expect(p.scores.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe('질문 선택', () => {
  it('아무 정보도 없는 질문은 고르지 않음', () => {
    const post = computePosterior(fixture, cfg, newGame('lunch'));
    const flat = expectedEntropy(fixture, post.scores, 3, 1);
    const soup = expectedEntropy(fixture, post.scores, 0, 1);
    expect(soup).toBeLessThan(flat);
    expect(selectQuestion(fixture, post.scores, new Set(), 1)).not.toBe(3);
  });
  it('이미 물은 질문은 다시 묻지 않음', () => {
    let s = newGame('lunch');
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const a = nextAction(fixture, { ...cfg, guessThreshold: 1.1, maxQuestions: 99 }, s);
      if (a.type !== 'ask') break;
      expect(seen.has(a.questionId)).toBe(false);
      seen.add(a.questionId);
      s = answer(s, a.questionId, 'dunno');
    }
    expect(seen.size).toBe(4);
  });
});

describe('nextAction', () => {
  const play = (answers: Record<string, 'yes' | 'no'>, config = cfg) => {
    let s = newGame('lunch');
    for (let i = 0; i < 10; i++) {
      const a = nextAction(fixture, config, s);
      if (a.type !== 'ask') return { action: a, state: s };
      s = answer(s, a.questionId, answers[a.questionId] ?? 'no');
    }
    throw new Error('끝나지 않음');
  };

  it('명확한 답이면 정답을 추측', () => {
    const { action } = play({ q_soup: 'yes', q_spicy: 'yes', q_noodle: 'no' });
    expect(action).toMatchObject({ type: 'guess', menuId: 'kimchi' });
  });
  it('최소 질문 수 전에는 점수가 높아도 추측하지 않음', () => {
    const { action, state } = play({ q_soup: 'yes', q_spicy: 'yes' }, { ...cfg, guessThreshold: 0.3, minQuestions: 3 });
    expect(action.type).toBe('guess');
    expect(state.events.length).toBeGreaterThanOrEqual(3);
  });
  it('최대 질문 수에 도달하면 상위 3개를 공개', () => {
    let s = newGame('lunch');
    const config = { ...cfg, maxQuestions: 2, guessThreshold: 1.1 };
    for (let i = 0; i < 2; i++) {
      const a = nextAction(fixture, config, s);
      if (a.type !== 'ask') throw new Error('ask 기대');
      s = answer(s, a.questionId, 'dunno');
    }
    const a = nextAction(fixture, config, s);
    expect(a.type).toBe('giveUp');
    if (a.type === 'giveUp') expect(a.top).toHaveLength(3);
  });
  it('거절한 메뉴는 다시 추측하지 않음', () => {
    let { action, state } = play({ q_soup: 'yes', q_spicy: 'yes', q_noodle: 'no' });
    expect(action).toMatchObject({ type: 'guess', menuId: 'kimchi' });
    state = rejectGuess(state, 'kimchi');
    for (let i = 0; i < 10; i++) {
      const a = nextAction(fixture, cfg, state);
      if (a.type === 'guess') expect(a.menuId).not.toBe('kimchi');
      if (a.type !== 'ask') {
        if (a.type === 'giveUp') expect(a.top.map((t) => t.menuId)).not.toContain('kimchi');
        break;
      }
      state = answer(state, a.questionId, 'dunno');
    }
  });
});

describe('되돌리기', () => {
  it('마지막 답변을 지움', () => {
    const s1 = answer(newGame('lunch'), 'q_soup', 'yes');
    const s2 = answer(s1, 'q_spicy', 'no');
    expect(undo(s2).events).toEqual(s1.events);
  });
  it('추측 거절 뒤에 되돌리면 직전 답변과 거절이 함께 취소됨', () => {
    const s1 = answer(newGame('lunch'), 'q_soup', 'yes');
    const s2 = answer(s1, 'q_spicy', 'yes');
    const s3 = rejectGuess(s2, 'kimchi');
    expect(undo(s3).events).toEqual(s1.events);
    expect(computePosterior(fixture, cfg, undo(s3)).rejectedIdx.size).toBe(0);
  });
  it('거절 후 새 질문에 답한 상태에서 되돌리면 거절은 유지', () => {
    const s3 = rejectGuess(answer(newGame('lunch'), 'q_soup', 'yes'), 'kimchi');
    const s4 = answer(s3, 'q_noodle', 'no');
    const u = undo(s4);
    expect(u.events).toEqual(s3.events);
    expect(computePosterior(fixture, cfg, u).rejectedIdx.has(0)).toBe(true);
  });
  it('되돌린 상태의 점수는 처음부터 그 답변만 한 것과 같음 (결정적)', () => {
    const a = answer(newGame('lunch'), 'q_soup', 'yes');
    const b = undo(answer(a, 'q_spicy', 'no'));
    expect([...computePosterior(fixture, cfg, b).scores]).toEqual([...computePosterior(fixture, cfg, a).scores]);
  });
  it('빈 기록에서 되돌리기는 안전', () => {
    expect(undo(newGame('lunch')).events).toEqual([]);
  });
});

describe('α와 실수율', () => {
  const s = answer(answer(answer(newGame('lunch'), 'q_soup', 'yes'), 'q_spicy', 'no'), 'q_noodle', 'yes');
  const order = (p: ReturnType<typeof computePosterior>) => [...p.scores.keys()].sort((a, b) => p.scores[b] - p.scores[a]);

  it('균등 사전확률·같은 답변 기록이면 α를 바꿔도 순위는 같고 집중도만 달라진다', () => {
    const base = computePosterior(fixture, cfg, s);
    for (const alpha of [0.3, 0.5, 0.7, 2]) {
      const p = computePosterior(fixture, { ...cfg, evidenceWeight: alpha }, s);
      expect(order(p)).toEqual(order(base));
      if (alpha < 1) expect(Math.max(...p.scores)).toBeLessThan(Math.max(...base.scores));
    }
  });
  it('withSlip: 0이면 그대로, 0.5면 정보 없음', () => {
    expect(withSlip(0.9, 0)).toBeCloseTo(0.9);
    expect(withSlip(0.98, 0.05)).toBeCloseTo(0.05 + 0.9 * 0.98);
    expect(withSlip(0.1, 0.5)).toBeCloseTo(0.5);
  });
  it('실수율을 반영하면 반대 답 한 번에 정답 후보가 덜 무너진다', () => {
    const contra = answer(newGame('lunch'), 'q_noodle', 'yes'); // 김치찌개(면 0.1)인데 '예'
    const strict = computePosterior(fixture, cfg, contra);
    const slip = computePosterior(fixture, { ...cfg, slipRate: 0.1 }, contra);
    expect(score(slip, 'kimchi')).toBeGreaterThan(score(strict, 'kimchi'));
  });
});

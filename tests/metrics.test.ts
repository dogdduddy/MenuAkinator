import { describe, expect, it } from 'vitest';
import { estimateSlip, summarize, type PlayRecord } from '../scripts/lib/metrics.ts';

describe('estimateSlip', () => {
  it('p=0.98, s=0.05이면 반대 답변은 6.8%이고, 거기서 s=0.05를 되찾는다', () => {
    const qs = new Array(10000).fill(0.02);
    const contradictions = Math.round(10000 * (0.02 + 0.05 * (1 - 2 * 0.02))); // 680
    expect(contradictions).toBe(680);
    const e = estimateSlip(qs, contradictions);
    expect(e.observed).toBeCloseTo(0.068);
    expect(e.tableBaseline).toBeCloseTo(0.02);
    expect(e.slip).toBeCloseTo(0.05, 3);
  });
  it('반대 답변이 표의 불확실성보다 적으면 0으로 자른다', () => {
    expect(estimateSlip([0.02, 0.02, 0.02], 0).slip).toBe(0);
  });
  it('답변이 없으면 NaN', () => {
    expect(estimateSlip([], 0).slip).toBeNaN();
  });
});

describe('summarize 분모', () => {
  const g = (correct: boolean) => ({ menuId: 'x', score: 0.8, afterQuestions: 5, correct });
  const recs: PlayRecord[] = [
    { guesses: [g(true)], solved: true, questionCount: 5, finalTop: [], target: 'a' },
    { guesses: [g(false), g(true)], solved: true, questionCount: 8, finalTop: [], target: 'a' },
    { guesses: [], solved: false, questionCount: 15, finalTop: ['a', 'b', 'c'], target: 'a' },
    { guesses: [g(false)], solved: false, questionCount: 15, finalTop: ['b'], target: null },
  ];
  const s = summarize(recs);
  it('첫추측은 게임 기준과 추측 기준을 구분', () => {
    expect(s.firstGuessAccPerGame).toBeCloseTo(1 / 4);
    expect(s.firstGuessAccPerGuessed).toBeCloseTo(1 / 3);
    expect(s.guessRatePerGame).toBeCloseTo(3 / 4);
  });
  it('후보 안에 있던 판은 추측성공과 따로 센다', () => {
    expect(s.solvedByGuessPerGame).toBeCloseTo(2 / 4);
    expect(s.inCandidatesPerGame).toBeCloseTo(1 / 4);
    expect(s.noTargetPerGame).toBeCloseTo(1 / 4);
  });
  it('평균 질문 수는 모든 게임 포함', () => {
    expect(s.avgQuestionsAll).toBeCloseTo((5 + 8 + 15 + 15) / 4);
    expect(s.avgQuestionsSolved).toBeCloseTo(6.5);
  });
});

describe('binomialTail', () => {
  it('P(X ≥ 0) = 1, 알려진 값과 일치', async () => {
    const { binomialTail } = await import('../scripts/lib/metrics.ts');
    expect(binomialTail(5, 0, 0.1)).toBeCloseTo(1);
    // P(X≥3 | n=5, p=0.1) = 10·0.001·0.81 + 5·0.0001·0.9 + 0.00001 = 0.00856
    expect(binomialTail(5, 3, 0.1)).toBeCloseTo(0.00856, 5);
  });
});

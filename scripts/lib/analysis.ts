import { entropy, expectedEntropy } from '../../src/engine/select.ts';
import type { GameData } from '../../src/engine/types.ts';

/** 두 메뉴의 값 차이가 이 이상이면 그 질문이 두 메뉴를 "강하게 가른다"고 본다 (0.1 vs 0.9 = 0.8) */
export const STRONG_GAP = 0.6;
/** 두 질문의 메뉴 전체 상관계수 절댓값이 이 이상이면 중복 의심 */
export const REDUNDANT_R = 0.85;

export interface PairInfo {
  a: string;
  b: string;
  strong: string[];
}

export interface QuestionStat {
  id: string;
  text: string;
  group: string;
  scope: string;
  /** 균등 사전확률에서 이 질문 하나로 줄어드는 엔트로피 (bits) */
  initialGainBits: number;
  /** 0.9(예 쪽)로 표시된 메뉴 수 */
  yesCount: number;
  /** 이 질문만이 강하게 가르는 메뉴 쌍의 수. 높으면 선택 빈도가 낮아도 지우면 안 된다 */
  uniquePairs: number;
}

export interface DataAnalysis {
  identicalPairs: PairInfo[];
  /** 강한 구분 질문이 1개 이하인 쌍 */
  hardPairs: PairInfo[];
  redundantQuestions: { a: string; b: string; r: number }[];
  questionStats: QuestionStat[];
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

export function analyzeData(data: GameData): DataAnalysis {
  const { menus, questions, matrix } = data;
  const identicalPairs: PairInfo[] = [];
  const hardPairs: PairInfo[] = [];
  const unique = new Array(questions.length).fill(0);

  for (let a = 0; a < menus.length; a++) {
    for (let b = a + 1; b < menus.length; b++) {
      const strongIdx: number[] = [];
      let identical = true;
      for (let q = 0; q < questions.length; q++) {
        const gap = Math.abs(matrix[a][q] - matrix[b][q]);
        if (gap > 1e-9) identical = false;
        if (gap >= STRONG_GAP) strongIdx.push(q);
      }
      const info = { a: menus[a].id, b: menus[b].id, strong: strongIdx.map((q) => questions[q].id) };
      if (identical) identicalPairs.push(info);
      else if (strongIdx.length <= 1) hardPairs.push(info);
      if (strongIdx.length === 1) unique[strongIdx[0]]++;
    }
  }

  const cols = questions.map((_, q) => matrix.map((row) => row[q]));
  const redundantQuestions: DataAnalysis['redundantQuestions'] = [];
  for (let a = 0; a < questions.length; a++) {
    for (let b = a + 1; b < questions.length; b++) {
      const r = pearson(cols[a], cols[b]);
      if (Math.abs(r) >= REDUNDANT_R) redundantQuestions.push({ a: questions[a].id, b: questions[b].id, r });
    }
  }
  redundantQuestions.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  const uniform = new Float64Array(menus.length).fill(1 / menus.length);
  const h0 = entropy(uniform);
  const questionStats = questions.map((q, qi) => ({
    id: q.id,
    text: q.text,
    group: q.group,
    scope: q.scope,
    initialGainBits: (h0 - expectedEntropy(data, uniform, qi, 1)) / Math.LN2,
    yesCount: cols[qi].filter((v) => v >= 0.7).length,
    uniquePairs: unique[qi],
  }));

  return { identicalPairs, hardPairs, redundantQuestions, questionStats };
}

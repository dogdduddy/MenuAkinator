import { withSlip } from './likelihood.ts';
import type { GameData } from './types.ts';

/** 가중치 배열 w(합 Z)를 정규화했을 때의 엔트로피 (nats) */
function entropyOf(wSum: number, wLogW: number): number {
  if (wSum <= 0) return 0;
  return Math.log(wSum) - wLogW / wSum;
}

/**
 * 질문 qi를 했을 때의 기대 엔트로피.
 *
 * 근사: 사용자가 예/아니요 둘 중 하나로만 답한다고 가정한다 (P(예|메뉴) = p).
 * '모르겠어요' 비율이 모든 질문에서 같다면 이 근사로 고른 질문 순위는 5종 답변 기준과 동일하지만,
 * 질문마다 '모르겠어요' 비율이 다르면 순위가 달라질 수 있다. 질문별 비율은 실사용 로그로 측정해야 한다.
 */
export function expectedEntropy(
  data: GameData,
  scores: Float64Array,
  qi: number,
  evidenceWeight: number,
  slip = 0,
): number {
  let pYes = 0;
  let yS = 0, yL = 0, nS = 0, nL = 0;
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (s <= 0) continue;
    const p = withSlip(data.matrix[i][qi], slip);
    pYes += s * p;
    const wy = s * Math.pow(p, evidenceWeight);
    const wn = s * Math.pow(1 - p, evidenceWeight);
    yS += wy; yL += wy * Math.log(wy);
    nS += wn; nL += wn * Math.log(wn);
  }
  return pYes * entropyOf(yS, yL) + (1 - pYes) * entropyOf(nS, nL);
}

/** 아직 묻지 않은 질문 중 기대 엔트로피가 가장 낮은 질문의 인덱스. 없으면 -1 */
export function selectQuestion(
  data: GameData,
  scores: Float64Array,
  askedIdx: ReadonlySet<number>,
  evidenceWeight: number,
  slip = 0,
): number {
  let best = -1;
  let bestH = Infinity;
  for (let qi = 0; qi < data.questions.length; qi++) {
    if (askedIdx.has(qi)) continue;
    const h = expectedEntropy(data, scores, qi, evidenceWeight, slip);
    if (h < bestH - 1e-12) {
      bestH = h;
      best = qi;
    }
  }
  return best;
}

/** 현재 분포의 엔트로피 */
export function entropy(scores: Float64Array): number {
  let h = 0;
  for (const s of scores) if (s > 0) h -= s * Math.log(s);
  return h;
}

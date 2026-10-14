import type { Answer } from './types.ts';

export const P_MIN = 0.02;
export const P_MAX = 0.98;

export const clampP = (p: number) => Math.min(P_MAX, Math.max(P_MIN, p));

/**
 * 답변 실수율(slip) 반영: 사람이 slip 확률로 반대로 답한다고 보면 P(예) = slip + (1 − 2·slip)·p.
 * slip = 0이면 표의 값 그대로.
 */
export const withSlip = (p: number, slip: number) => slip + (1 - 2 * slip) * p;

/**
 * 답변 하나의 likelihood P(답변 | 메뉴).
 * 예·아니요는 표의 확률 그대로. 아마도·아마 아니요는 0.5 쪽으로 완화한 휴리스틱 값이며,
 * 실제 "아마도"를 고를 확률을 모델링한 것은 아니다.
 * 모르겠어요는 업데이트하지 않으므로 null.
 */
export function likelihood(p: number, answer: Answer, softFactor: number, slip = 0): number | null {
  p = withSlip(p, slip);
  switch (answer) {
    case 'yes':
      return p;
    case 'no':
      return 1 - p;
    case 'probably':
      return 0.5 + (p - 0.5) * softFactor;
    case 'probablyNot':
      return 0.5 - (p - 0.5) * softFactor;
    case 'dunno':
      return null;
  }
}

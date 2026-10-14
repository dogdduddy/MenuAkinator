import type { GameData, TimeSlot } from './types.ts';

/** 아침 05–10, 점심 10–15, 저녁 15–21, 야식 21–05 (기기 시계 기준) */
export function timeSlotOf(date: Date): TimeSlot {
  const h = date.getHours();
  if (h >= 5 && h < 10) return 'morning';
  if (h >= 10 && h < 15) return 'lunch';
  if (h >= 15 && h < 21) return 'dinner';
  return 'latenight';
}

/**
 * 메뉴별 사전확률 (합 1).
 * 시간대 가중치는 초벌 추정치일 뿐 실제 사용자 분포가 아니다. OFF면 균등.
 */
export function prior(data: GameData, useTimePrior: boolean, slot: TimeSlot): Float64Array {
  const out = new Float64Array(data.menus.length);
  let sum = 0;
  data.menus.forEach((m, i) => {
    out[i] = useTimePrior ? m.timeWeights[slot] : 1;
    sum += out[i];
  });
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

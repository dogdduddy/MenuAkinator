import type { GameRecord, ResultSink } from './types.ts';

/** 개발 서버(vite.config.ts의 resultsFilePlugin)가 받는 주소 */
export const DEV_RESULTS_ENDPOINT = '/__results';

/**
 * 개발 서버(npm run dev)로 결과를 보내 프로젝트의 results/results.jsonl 에 한 줄씩 쌓는다.
 * 배포된 정적 사이트에는 받는 쪽이 없으므로 DEV일 때만 쓴다.
 * 나중에 실제 서버를 붙일 때는 이 클래스처럼 HTTP로 보내는 Sink를 하나 더 만들면 된다.
 */
export class DevFileSink implements ResultSink {
  readonly label = '개발 PC 파일';

  constructor(private readonly endpoint = DEV_RESULTS_ENDPOINT) {}

  async save(record: GameRecord): Promise<void> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(`파일 저장 실패: HTTP ${res.status}`);
  }
}

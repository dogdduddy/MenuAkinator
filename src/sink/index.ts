import { DevFileSink } from './DevFileSink.ts';
import { LocalStorageSink } from './LocalStorageSink.ts';
import type { GameRecord, ResultSink } from './types.ts';

export * from './types.ts';
export { LocalStorageSink } from './LocalStorageSink.ts';
export { DevFileSink } from './DevFileSink.ts';

export interface SaveStatus {
  label: string;
  ok: boolean;
  error?: string;
}

/** 여러 Sink에 동시에 저장한다. 하나가 실패해도 나머지는 저장된다. */
export async function saveToAll(sinks: ResultSink[], record: GameRecord): Promise<SaveStatus[]> {
  const settled = await Promise.allSettled(sinks.map((s) => s.save(record)));
  return settled.map((r, i) => ({
    label: sinks[i].label,
    ok: r.status === 'fulfilled',
    error: r.status === 'rejected' ? String((r.reason as Error)?.message ?? r.reason) : undefined,
  }));
}

export const localSink = new LocalStorageSink();

/** 개발 서버에서는 파일 + localStorage(백업), 배포본에서는 localStorage만 */
export const sinks: ResultSink[] = import.meta.env.DEV ? [new DevFileSink(), localSink] : [localSink];

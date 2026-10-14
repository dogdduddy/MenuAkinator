import type { GameRecord, GameResult, ResultSink } from './types.ts';

const KEY = 'menu-akinator:results';

/**
 * 이 브라우저의 localStorage에 결과를 쌓는다.
 * 사생활 보호 모드·저장소 차단·용량 초과 등으로 언제든 실패할 수 있으므로 모든 접근을 try/catch로 감싼다.
 */
export class LocalStorageSink implements ResultSink {
  readonly label = '이 브라우저';

  async save(record: GameRecord): Promise<void> {
    const all = this.list();
    all.push(record);
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) {
      throw new Error(`localStorage 저장 실패: ${(e as Error).message}`);
    }
  }

  /** 시작 기록과 결과 기록 전부 (내려받기용) */
  list(): GameRecord[] {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** 끝난 게임 결과만 */
  results(): GameResult[] {
    // kind가 없는 기록은 시작 기록을 남기기 전 버전의 결과
    return this.list().filter((r): r is GameResult => (r as { kind?: string }).kind !== 'start');
  }

  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // 지울 수 없으면 무시
    }
  }
}

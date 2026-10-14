// 브라우저별 식별자와 게임 시작 횟수. 저장이 막혀 있어도 게임은 돌아가야 하므로 실패는 조용히 넘긴다.

const DEVICE_KEY = 'menu-akinator:deviceId';
const PLAYS_KEY = 'menu-akinator:plays';

let memoryDeviceId: string | null = null;
let memoryPlays = 0;

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    memoryDeviceId ??= randomId();
    return memoryDeviceId;
  }
}

/** 새 게임을 시작할 때 호출. 1부터 시작하는 순번을 돌려준다 */
export function nextPlayIndex(): number {
  try {
    const n = Number(localStorage.getItem(PLAYS_KEY) ?? '0') + 1;
    localStorage.setItem(PLAYS_KEY, String(n));
    return n;
  } catch {
    return ++memoryPlays;
  }
}

const MODE_KEY = 'menu-akinator:mode';

/** 테스트 모드 (숨김 메뉴에서 바꿈). 기본은 자유 */
export function getPlayMode(): 'free' | 'assigned' {
  try {
    return localStorage.getItem(MODE_KEY) === 'assigned' ? 'assigned' : 'free';
  } catch {
    return 'free';
  }
}

export function setPlayMode(mode: 'free' | 'assigned'): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // 저장이 막혀 있으면 이번 세션에만 적용되지 않음 — 무시
  }
}

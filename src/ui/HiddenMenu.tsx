import { useEffect, useState } from 'preact/hooks';
import { DEV_RESULTS_ENDPOINT } from '../sink/DevFileSink.ts';
import { localSink } from '../sink/index.ts';
import type { PlayMode } from '../sink/index.ts';
import { ENGINE_VERSION } from '../engine/index.ts';
import { config, data } from './gameData.ts';

/** 제목을 2초 안에 5번 탭하면 열리는 테스트용 메뉴 */
export function HiddenMenu(props: { mode: PlayMode; onModeChange: (m: PlayMode) => void; onClose: () => void }) {
  const [count, setCount] = useState(() => localSink.results().length);
  const [fileInfo, setFileInfo] = useState<string>(import.meta.env.DEV ? '확인 중…' : '배포본에서는 사용 안 함');

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fetch(DEV_RESULTS_ENDPOINT)
      .then((r) => r.json())
      .then((j: { file: string; count: number }) => setFileInfo(`${j.file} · ${j.count}개`))
      .catch(() => setFileInfo('개발 서버에 연결할 수 없음'));
  }, []);

  const download = () => {
    const list = localSink.list();
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `menu-akinator-results-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const clear = () => {
    if (!confirm(`이 브라우저에 저장된 기록 ${count}개를 지울까요? 개발 PC 파일은 지워지지 않습니다.`)) return;
    localSink.clear();
    setCount(localSink.results().length);
  };

  return (
    <div class="sheet-backdrop" onClick={props.onClose}>
      <div class="sheet" role="dialog" aria-label="테스트 메뉴" onClick={(e) => e.stopPropagation()}>
        <h2>테스트 메뉴</h2>
        <div class="segmented" role="radiogroup" aria-label="테스트 모드">
          <button type="button" role="radio" aria-checked={props.mode === 'free'} class={props.mode === 'free' ? 'on' : ''} onClick={() => props.onModeChange('free')}>
            자유 모드<small>아무 메뉴나 떠올림</small>
          </button>
          <button type="button" role="radio" aria-checked={props.mode === 'assigned'} class={props.mode === 'assigned' ? 'on' : ''} onClick={() => props.onModeChange('assigned')}>
            지정 메뉴 모드<small>목록에서 정해준 메뉴</small>
          </button>
        </div>
        <dl class="info">
          <dt>이 브라우저 기록</dt><dd>{count}개</dd>
          <dt>개발 PC 파일</dt><dd>{fileInfo}</dd>
          <dt>버전</dt><dd>데이터 {data.version} · 엔진 {ENGINE_VERSION} · 메뉴 {data.menus.length} · 질문 {data.questions.length}</dd>
          <dt>엔진 설정</dt>
          <dd>임계값 {config.guessThreshold} · 최소 {config.minQuestions} · 최대 {config.maxQuestions} · α {config.evidenceWeight} · 실수율 {config.slipRate} · 시간대 {config.useTimePrior ? 'ON' : 'OFF'}</dd>
        </dl>
        <button type="button" class="primary" onClick={download} disabled={count === 0}>기록 JSON 내려받기</button>
        <button type="button" class="secondary danger" onClick={clear} disabled={count === 0}>이 브라우저 기록 지우기</button>
        <button type="button" class="ghost" onClick={props.onClose}>닫기</button>
      </div>
    </div>
  );
}

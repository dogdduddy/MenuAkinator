import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Answer, Menu, Question, Ranked } from '../engine/index.ts';
import type { GameResult, PlayMode, SaveStatus } from '../sink/index.ts';
import { menuById } from './gameData.ts';

const ANSWER_BUTTONS: { value: Answer; label: string; tone: string }[] = [
  { value: 'yes', label: '예', tone: 'yes' },
  { value: 'probably', label: '아마도', tone: 'soft-yes' },
  { value: 'dunno', label: '모르겠어요', tone: 'neutral' },
  { value: 'probablyNot', label: '아마 아니요', tone: 'soft-no' },
  { value: 'no', label: '아니요', tone: 'no' },
];

/** 마지막 글자에 받침이 있으면 '이었', 없으면 '였' */
function wasSuffix(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasBatchim = code >= 0 && code <= 11171 && code % 28 !== 0;
  return hasBatchim ? '이었' : '였';
}

const SLOT_LABEL = { morning: '아침', lunch: '점심', dinner: '저녁', latenight: '야식' } as const;

export function StartScreen(props: { menuCount: number; mode: PlayMode; onStart: () => void }) {
  if (props.mode === 'assigned') {
    return (
      <section class="center">
        <p class="eyebrow">지정 메뉴 모드</p>
        <h1 class="headline">메뉴를 하나<br />정해 드릴게요</h1>
        <p class="sub">다음 화면에 나오는 메뉴를 기억하고,<br />그 메뉴를 떠올린 채로 답해 주세요.</p>
        <button type="button" class="primary big" onClick={props.onStart}>메뉴 받기</button>
      </section>
    );
  }
  return (
    <section class="center">
      <p class="eyebrow">메뉴 {props.menuCount}개 중에서</p>
      <h1 class="headline">먹고 싶은 메뉴를<br />하나 떠올려 보세요</h1>
      <p class="sub">질문 몇 개로 맞혀볼게요.<br />정답은 마음속으로만 정해두세요.</p>
      <button type="button" class="primary big" onClick={props.onStart}>시작하기</button>
    </section>
  );
}

export function AssignScreen(props: { menu: Menu; onReady: () => void; onCancel: () => void }) {
  return (
    <section class="center">
      <p class="eyebrow">이번 판의 메뉴</p>
      <h1 class="guess">{props.menu.name}</h1>
      {props.menu.aliases.length > 0 && <p class="aliases">{props.menu.aliases.join(' · ')} 포함</p>}
      <p class="sub">이 메뉴를 떠올린 채로 답해 주세요.<br />게임 중에는 다시 보여주지 않아요.</p>
      <button type="button" class="primary big" onClick={props.onReady}>기억했어요, 시작</button>
      <div class="footer-actions">
        <button type="button" class="ghost" onClick={props.onCancel}>← 처음으로</button>
      </div>
    </section>
  );
}

export function QuestionScreen(props: {
  question: Question;
  number: number;
  max: number;
  canUndo: boolean;
  onAnswer: (a: Answer) => void;
  onUndo: () => void;
  onShowCandidates: () => void;
}) {
  const { question, number, max } = props;
  return (
    <section class="stack">
      <div class="progress" aria-label={`질문 ${number} / ${max}`}>
        <div class="progress-label">질문 {number} <span>/ {max}</span></div>
        <div class="progress-track"><div class="progress-fill" style={{ width: `${(Math.min(number - 1, max) / max) * 100}%` }} /></div>
      </div>
      <h2 class="question" key={question.id}>{question.text}</h2>
      <div class="answers">
        {ANSWER_BUTTONS.map((b) => (
          <button type="button" key={b.value} class={`answer ${b.tone}`} onClick={() => props.onAnswer(b.value)}>
            {b.label}
          </button>
        ))}
      </div>
      <div class="footer-actions">
        <button type="button" class="ghost" disabled={!props.canUndo} onClick={props.onUndo}>← 이전 질문으로</button>
        <button type="button" class="ghost" onClick={props.onShowCandidates}>그냥 후보 보여줘</button>
      </div>
    </section>
  );
}

export function GuessScreen(props: {
  menu: Menu;
  questionCount: number;
  canUndo: boolean;
  onYes: () => void;
  onNo: () => void;
  onUndo: () => void;
}) {
  return (
    <section class="center">
      <p class="eyebrow">질문 {props.questionCount}개 만에…</p>
      <p class="sub">혹시</p>
      <h1 class="guess" key={props.menu.id}>{props.menu.name}?</h1>
      {props.menu.aliases.length > 0 && <p class="aliases">{props.menu.aliases.join(' · ')} 포함</p>}
      <div class="row">
        <button type="button" class="primary big" onClick={props.onYes}>맞아요!</button>
        <button type="button" class="secondary big" onClick={props.onNo}>아니에요</button>
      </div>
      <div class="footer-actions">
        <button type="button" class="ghost" disabled={!props.canUndo} onClick={props.onUndo}>← 이전 질문으로</button>
      </div>
    </section>
  );
}

export function CandidatesScreen(props: {
  top: Ranked[];
  reason: 'maxQuestions' | 'userAskedCandidates';
  /** 지정 메뉴 모드면 정답을 이미 알고 있으므로 고르게 하지 않는다 */
  assigned?: Menu;
  canContinue: boolean;
  canUndo: boolean;
  onPick: (menuId: string) => void;
  onNoneOfThese: () => void;
  onFinishAssigned: () => void;
  onContinue: () => void;
  onUndo: () => void;
}) {
  if (props.assigned) {
    return (
      <section class="stack">
        <h2 class="question">
          {props.reason === 'maxQuestions' ? '질문을 다 썼어요. 제 후보는 이랬어요.' : '지금 후보는 이래요.'}
        </h2>
        <div class="candidates">
          {props.top.map((t, i) => (
            <div key={t.menuId} class="candidate static">
              <span class="rank">{i + 1}</span>
              <span class="cand-name">{menuById.get(t.menuId)!.name}</span>
            </div>
          ))}
        </div>
        <button type="button" class="primary" onClick={props.onFinishAssigned}>결과 보기</button>
        <div class="footer-actions">
          <button type="button" class="ghost" disabled={!props.canUndo} onClick={props.onUndo}>← 이전 질문으로</button>
          {props.canContinue && <button type="button" class="ghost" onClick={props.onContinue}>계속 질문하기 →</button>}
        </div>
      </section>
    );
  }
  return (
    <section class="stack">
      <h2 class="question">
        {props.reason === 'maxQuestions' ? '질문을 다 썼어요. 이 중에 있나요?' : '지금 후보는 이래요. 이 중에 있나요?'}
      </h2>
      <div class="candidates">
        {props.top.map((t, i) => {
          const m = menuById.get(t.menuId)!;
          return (
            <button type="button" key={t.menuId} class="candidate" onClick={() => props.onPick(t.menuId)}>
              <span class="rank">{i + 1}</span>
              <span class="cand-name">{m.name}</span>
            </button>
          );
        })}
      </div>
      <button type="button" class="secondary" onClick={props.onNoneOfThese}>여기 없어요</button>
      <div class="footer-actions">
        <button type="button" class="ghost" disabled={!props.canUndo} onClick={props.onUndo}>← 이전 질문으로</button>
        {props.canContinue && <button type="button" class="ghost" onClick={props.onContinue}>계속 질문하기 →</button>}
      </div>
    </section>
  );
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');

export function PickScreen(props: {
  menus: Menu[];
  onPick: (menuId: string) => void;
  onNotInList: (name: string | undefined) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState('');
  const [notInList, setNotInList] = useState(false);
  const [name, setName] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    (notInList ? nameRef : searchRef).current?.focus();
  }, [notInList]);
  const matches = useMemo(() => {
    const n = normalize(q);
    const list = n
      ? props.menus.filter((m) => [m.name, ...m.aliases].some((x) => normalize(x).includes(n)))
      : props.menus;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [q, props.menus]);

  if (notInList) {
    return (
      <section class="stack">
        <h2 class="question">어떤 메뉴였는지 알려주실래요?</h2>
        <p class="sub">다음 버전에 추가할 메뉴 후보로 쓸게요. 비워둬도 괜찮아요.</p>
        <input
          class="search"
          type="text"
          placeholder="예: 우삼겹 덮밥"
          value={name}
          maxLength={40}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          ref={nameRef}
        />
        <button type="button" class="primary" onClick={() => props.onNotInList(name.trim() || undefined)}>완료</button>
        <div class="footer-actions">
          <button type="button" class="ghost" onClick={() => setNotInList(false)}>← 목록에서 다시 찾기</button>
        </div>
      </section>
    );
  }

  return (
    <section class="stack">
      <h2 class="question">정답이 뭐였어요?</h2>
      <input
        class="search"
        type="search"
        placeholder="메뉴 이름 검색"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        ref={searchRef}
      />
      <ul class="menu-list">
        {matches.map((m) => (
          <li key={m.id}>
            <button type="button" class="menu-item" onClick={() => props.onPick(m.id)}>
              <span>{m.name}</span>
              {m.aliases.length > 0 && <span class="menu-aliases">{m.aliases.join(', ')}</span>}
            </button>
          </li>
        ))}
        {matches.length === 0 && <li class="empty">검색 결과가 없어요</li>}
      </ul>
      <button type="button" class="secondary" onClick={() => setNotInList(true)}>목록에 없어요</button>
      <div class="footer-actions">
        <button type="button" class="ghost" onClick={props.onBack}>← 후보로 돌아가기</button>
      </div>
    </section>
  );
}

export function DoneScreen(props: { result: GameResult; saved: SaveStatus[] | null; onRestart: () => void }) {
  const r = props.result;
  const answerName = r.finalMenuId ? menuById.get(r.finalMenuId)?.name : r.notInListName;
  const wrong = r.guesses.filter((g) => !g.correct).length;
  const sourceNote = r.finalSource === 'candidates' ? '후보에서 고름' : r.finalSource === 'search' ? '직접 찾음' : null;
  return (
    <section class="center">
      {r.solved ? (
        <>
          <p class="emoji" aria-hidden="true">🎉</p>
          <h1 class="headline">맞혔다!</h1>
          <p class="sub"><strong>{answerName}</strong>{wrong > 0 ? ` · ${wrong}번 틀린 뒤` : ''}</p>
        </>
      ) : (
        <>
          <p class="emoji" aria-hidden="true">🤔</p>
          <h1 class="headline">아쉽다…</h1>
          <p class="sub">
            {answerName ? <>정답은 <strong>{answerName}</strong>{wasSuffix(answerName)}군요.</> : '목록에 없는 메뉴였군요.'}
            {sourceNote && <> ({sourceNote})</>}
            <br />다음엔 꼭 맞혀볼게요.
          </p>
        </>
      )}
      <p class="meta">{r.mode === 'assigned' ? '지정 메뉴 · ' : ''}{SLOT_LABEL[r.timeSlot]} · 질문 {r.questionCount}개 · {Math.round(r.durationMs / 1000)}초</p>
      <button type="button" class="primary big" onClick={props.onRestart}>한 판 더</button>
      <p class="save-status" aria-live="polite">
        {props.saved === null
          ? '기록 저장 중…'
          : props.saved.map((s) => `${s.label} ${s.ok ? '✓' : '✗'}`).join(' · ')}
      </p>
    </section>
  );
}

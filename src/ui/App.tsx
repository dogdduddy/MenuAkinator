import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ENGINE_VERSION, answer, computePosterior, newGame, nextAction, ranked, rejectGuess, timeSlotOf, undo,
  type Answer, type GameState, type Ranked,
} from '../engine/index.ts';
import { deviceId, getPlayMode, nextPlayIndex, setPlayMode } from '../device.ts';
import {
  saveToAll, sinks, type FinalSource, type GameResult, type GameStart, type GuessLog, type PlayMode, type SaveStatus,
} from '../sink/index.ts';
import { config, data, menuById, questionById } from './gameData.ts';
import { HiddenMenu } from './HiddenMenu.tsx';
import {
  AssignScreen, CandidatesScreen, DoneScreen, GuessScreen, PickScreen, QuestionScreen, StartScreen,
} from './screens.tsx';

type EndReason = 'maxQuestions' | 'userAskedCandidates';

interface Session {
  state: GameState;
  guesses: GuessLog[];
  playIndex: number;
  mode: PlayMode;
  assignedMenuId?: string;
  undoCount: number;
  startedAt: number;
  finalTop: string[];
}

type Screen =
  | { kind: 'start' }
  | { kind: 'assign'; menuId: string }
  | { kind: 'play' }
  | { kind: 'candidates'; reason: EndReason; top: Ranked[] }
  | { kind: 'pick'; reason: EndReason }
  | { kind: 'done'; result: GameResult; saved: SaveStatus[] | null };

const TAPS_TO_OPEN_MENU = 5;

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'start' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<PlayMode>(getPlayMode);
  const taps = useRef<number[]>([]);

  const post = useMemo(() => (session ? computePosterior(data, config, session.state) : null), [session]);
  const action = useMemo(
    () => (session && post ? nextAction(data, config, session.state, post) : null),
    [session, post],
  );

  const onTitleTap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2000), now];
    if (taps.current.length >= TAPS_TO_OPEN_MENU) {
      taps.current = [];
      setMenuOpen(true);
    }
  };

  const changeMode = (m: PlayMode) => {
    setPlayMode(m);
    setMode(m);
  };

  const onStart = () => {
    if (mode === 'assigned') {
      const m = data.menus[Math.floor(Math.random() * data.menus.length)];
      setScreen({ kind: 'assign', menuId: m.id });
    } else {
      begin(undefined);
    }
  };

  const begin = (assignedMenuId: string | undefined) => {
    const s: Session = {
      state: newGame(timeSlotOf(new Date())),
      guesses: [],
      playIndex: nextPlayIndex(),
      mode,
      ...(assignedMenuId ? { assignedMenuId } : {}),
      undoCount: 0,
      startedAt: Date.now(),
      finalTop: [],
    };
    setSession(s);
    setScreen({ kind: 'play' });
    // 시작 기록: 끝내지 않은 게임도 세기 위해 (완료율 = 결과 / 시작)
    const startRecord: GameStart = { kind: 'start', ...baseRecord(s) };
    void saveToAll(sinks, startRecord);
  };

  const finish = (
    s: Session,
    end: { endedBy: GameResult['endedBy']; finalMenuId: string | null; finalSource: FinalSource; notInListName?: string },
  ) => {
    const now = Date.now();
    const solved = end.finalSource === 'guess';
    const result: GameResult = {
      kind: 'result',
      ...baseRecord(s),
      events: [...s.state.events],
      guesses: s.guesses,
      endedBy: end.endedBy,
      finalMenuId: end.finalMenuId,
      finalSource: end.finalSource,
      notInList: end.finalMenuId === null,
      ...(end.notInListName ? { notInListName: end.notInListName } : {}),
      solved,
      firstGuessCorrect: s.guesses[0]?.correct ?? false,
      questionCount: computePosterior(data, config, s.state).questionCount,
      undoCount: s.undoCount,
      finalTop: s.finalTop,
      timestamp: new Date(now).toISOString(),
      durationMs: now - s.startedAt,
    };
    setScreen({ kind: 'done', result, saved: null });
    saveToAll(sinks, result).then((saved) =>
      setScreen((cur) => (cur.kind === 'done' && cur.result === result ? { ...cur, saved } : cur)),
    );
  };

  /** 엔진이 못 맞히고 끝날 때: 지정 메뉴 모드면 정답을 이미 알고 있으므로 바로 기록 */
  const finishUnsolved = (s: Session, reason: EndReason, picked?: { menuId: string | null; source: FinalSource; name?: string }) => {
    if (s.mode === 'assigned') {
      finish(s, { endedBy: reason, finalMenuId: s.assignedMenuId!, finalSource: 'assigned' });
    } else if (picked) {
      finish(s, { endedBy: reason, finalMenuId: picked.menuId, finalSource: picked.source, notInListName: picked.name });
    }
  };

  /** 되돌리기. 함께 취소된 추측 거절은 추측 기록에서도 지운다 */
  const goBack = (s: Session) => {
    const state = undo(s.state);
    const stillRejected = new Set(state.events.flatMap((e) => (e.type === 'reject' ? [e.menuId] : [])));
    setSession({
      ...s,
      state,
      undoCount: s.undoCount + 1,
      guesses: s.guesses.filter((g) => g.correct || stillRejected.has(g.menuId)),
    });
    setScreen({ kind: 'play' });
  };

  const showCandidates = (reason: EndReason, top: Ranked[]) => {
    if (!session) return;
    setSession({ ...session, finalTop: top.map((t) => t.menuId) });
    setScreen({ kind: 'candidates', reason, top });
  };

  // 최대 질문 수에 도달하면 후보 화면으로 전환하고, 보여준 후보를 기록한다.
  useEffect(() => {
    if (screen.kind === 'play' && action?.type === 'giveUp') showCandidates('maxQuestions', action.top);
  }, [screen.kind, action]);

  let body;
  if (screen.kind === 'assign') {
    body = <AssignScreen menu={menuById.get(screen.menuId)!} onReady={() => begin(screen.menuId)} onCancel={() => setScreen({ kind: 'start' })} />;
  } else if (screen.kind === 'start' || !session || !post || !action) {
    body = <StartScreen menuCount={data.menus.length} mode={mode} onStart={onStart} />;
  } else if (screen.kind === 'done') {
    body = <DoneScreen result={screen.result} saved={screen.saved} onRestart={onStart} />;
  } else if (screen.kind === 'pick') {
    const reason = screen.reason;
    body = (
      <PickScreen
        menus={data.menus}
        onPick={(menuId) => finishUnsolved(session, reason, { menuId, source: 'search' })}
        onNotInList={(name) => finishUnsolved(session, reason, { menuId: null, source: 'notInList', name })}
        onBack={() => setScreen({ kind: 'candidates', reason, top: rankedTop(session) })}
      />
    );
  } else if (screen.kind === 'candidates' || action.type === 'giveUp') {
    const reason: EndReason = screen.kind === 'candidates' ? screen.reason : 'maxQuestions';
    const top = screen.kind === 'candidates' ? screen.top : (action.type === 'giveUp' ? action.top : []);
    body = (
      <CandidatesScreen
        top={top}
        reason={reason}
        assigned={session.mode === 'assigned' ? menuById.get(session.assignedMenuId!) : undefined}
        canContinue={reason === 'userAskedCandidates' && action.type !== 'giveUp'}
        canUndo={post.questionCount > 0}
        onPick={(menuId) => finishUnsolved(session, reason, { menuId, source: 'candidates' })}
        onNoneOfThese={() => setScreen({ kind: 'pick', reason })}
        onFinishAssigned={() => finishUnsolved(session, reason)}
        onContinue={() => setScreen({ kind: 'play' })}
        onUndo={() => goBack(session)}
      />
    );
  } else if (action.type === 'guess') {
    const guessed = action.menuId;
    body = (
      <GuessScreen
        menu={menuById.get(guessed)!}
        questionCount={post.questionCount}
        canUndo={post.questionCount > 0}
        onYes={() => {
          const guesses = [...session.guesses, { menuId: guessed, score: action.score, afterQuestions: post.questionCount, correct: true }];
          // 지정 메뉴 모드에서 다른 메뉴에 "맞아요"를 누르면 사용자 실수 — 정답은 지정 메뉴로 기록하고 엔진 성공으로 세지 않는다
          if (session.mode === 'assigned' && guessed !== session.assignedMenuId) {
            finish({ ...session, guesses }, { endedBy: 'guessCorrect', finalMenuId: session.assignedMenuId!, finalSource: 'assigned' });
          } else {
            finish({ ...session, guesses }, { endedBy: 'guessCorrect', finalMenuId: guessed, finalSource: 'guess' });
          }
        }}
        onNo={() => setSession({
          ...session,
          guesses: [...session.guesses, { menuId: guessed, score: action.score, afterQuestions: post.questionCount, correct: false }],
          state: rejectGuess(session.state, guessed),
        })}
        onUndo={() => goBack(session)}
      />
    );
  } else {
    body = (
      <QuestionScreen
        question={questionById.get(action.questionId)!}
        number={post.questionCount + 1}
        max={config.maxQuestions}
        canUndo={post.questionCount > 0}
        onAnswer={(a: Answer) => setSession({ ...session, state: answer(session.state, action.questionId, a) })}
        onUndo={() => goBack(session)}
        onShowCandidates={() => showCandidates('userAskedCandidates', ranked(data, post, 3))}
      />
    );
  }

  return (
    <div class="app">
      <header class="topbar">
        <button type="button" class="title" onClick={onTitleTap} aria-label="메뉴 아키네이터">
          🍲 메뉴 아키네이터
        </button>
        {mode === 'assigned' && <span class="mode-badge">지정 메뉴 모드</span>}
      </header>
      <main class="screen">{body}</main>
      {menuOpen && <HiddenMenu mode={mode} onModeChange={changeMode} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

function baseRecord(s: Session) {
  return {
    schema: 1 as const,
    deviceId: deviceId(),
    playIndex: s.playIndex,
    mode: s.mode,
    ...(s.assignedMenuId ? { assignedMenuId: s.assignedMenuId } : {}),
    startedAt: new Date(s.startedAt).toISOString(),
    timeSlot: s.state.timeSlot,
    dataVersion: data.version,
    engineVersion: ENGINE_VERSION,
    config,
  };
}

function rankedTop(s: Session): Ranked[] {
  return ranked(data, computePosterior(data, config, s.state), 3);
}

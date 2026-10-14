// 실사용 테스트 결과 분석.
// 사용: npm run analyze                      → results/results.jsonl (개발 서버가 쌓은 파일)
//       npm run analyze -- a.json b.jsonl     → 숨김 메뉴에서 내려받은 JSON 등 여러 파일을 합쳐서
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePosterior, ranked, type GameData } from '../src/engine/index.ts';
import type { GameResult, GameStart } from '../src/sink/types.ts';
import {
  binomialTail, calibrationError, estimateSlip, METRIC_DEFINITIONS, num, pct, summarize, TARGETS, type PlayRecord, type Summary,
} from './lib/metrics.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length === 0) files.push(join(root, 'results/results.jsonl'));

// ───────── 읽기 + 중복 제거 ─────────
type Raw = (GameResult | GameStart) & { kind?: 'start' | 'result' };
const seen = new Set<string>();
const results: GameResult[] = [];
const starts: GameStart[] = [];
for (const f of files) {
  if (!existsSync(f)) {
    console.error(`파일 없음: ${f}`);
    continue;
  }
  const text = readFileSync(f, 'utf8').trim();
  if (!text) continue;
  const items: Raw[] = text.startsWith('[')
    ? JSON.parse(text)
    : text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const r of items) {
    if (r?.schema !== 1) continue;
    const kind = r.kind ?? 'result'; // kind가 없는 기록은 시작 기록 도입 전 버전의 결과
    const key = `${kind}|${r.deviceId}|${r.playIndex}|${r.startedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (kind === 'start') starts.push(r as GameStart);
    else {
      const g = r as GameResult;
      results.push({
        ...g,
        kind: 'result',
        mode: g.mode ?? 'free',
        finalSource: g.finalSource ?? (g.solved ? 'guess' : g.finalMenuId === null ? 'notInList' : 'search'),
      });
    }
  }
}
if (results.length === 0) {
  console.log('분석할 결과가 없습니다. 먼저 게임을 몇 판 해보세요. (가이드: TESTING.md)');
  process.exit(0);
}

const data: GameData = JSON.parse(readFileSync(join(root, 'src/generated/data.json'), 'utf8'));
const menuName = (id: string) => data.menus.find((m) => m.id === id)?.name ?? id;
const qIdx = new Map(data.questions.map((q, i) => [q.id, i]));
const mIdx = new Map(data.menus.map((m, i) => [m.id, i]));

const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(90));
const toRecord = (r: GameResult): PlayRecord => ({
  guesses: r.guesses, solved: r.solved, questionCount: r.questionCount, finalTop: r.finalTop, target: r.finalMenuId,
});
const count = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
};

// ───────── 개요 ─────────
const devices = new Set(results.map((r) => r.deviceId));
const versions = count(results, (r) => `데이터 ${r.dataVersion} / 엔진 ${r.engineVersion ?? '?'}`);
line();
line(`실사용 결과 ${results.length}판 · 시작 기록 ${starts.length}개 · 기기 ${devices.size}대 · 파일 ${files.length}개`);
line(`버전: ${[...versions].map(([v, n]) => `${v} (${n}판)`).join(', ')} · 현재 데이터 ${data.version}`);
if (versions.size > 1) line('⚠️  데이터·엔진 버전이 섞여 있습니다. 버전별로 파일을 나눠서 분석하세요.');
const configs = count(results, (r) => JSON.stringify(r.config));
if (configs.size > 1) line(`⚠️  엔진 설정이 ${configs.size}가지 섞여 있습니다 (임계값·α·실수율·시간대 등).`);
if (results.length < 30) line(`⚠️  ${results.length}판은 적습니다. 비율은 방향만 참고하세요. 지금 단계의 목적은 "어디서 헷갈리고 실패하는지" 찾는 것입니다.`);
hr();

// ───────── 완료율 ─────────
const resultKeys = new Set(results.map((r) => `${r.deviceId}|${r.playIndex}`));
if (starts.length > 0) {
  const startKeys = new Set(starts.map((s) => `${s.deviceId}|${s.playIndex}`));
  const finished = [...startKeys].filter((k) => resultKeys.has(k)).length;
  const c = finished / startKeys.size;
  line(`게임 완료율 = 끝낸 게임 / 시작한 게임 = ${finished}/${startKeys.size} = ${pct(c)}  (목표 ≥ ${pct(TARGETS.completionRate)} ${c >= TARGETS.completionRate ? '✅' : '❌'})`);
} else {
  line('게임 완료율: 시작 기록이 없어 계산할 수 없습니다 (이전 버전에서 쌓인 결과).');
}
hr();

// ───────── 모드별 핵심 지표 ─────────
const MODE_LABEL = { assigned: '지정 메뉴 모드 (엔진·질문 품질)', free: '자유 모드 (메뉴 범위·실제 경험)' } as const;
function printSummary(label: string, rs: GameResult[]) {
  const s: Summary = summarize(rs.map(toRecord));
  const first = rs.filter((r) => r.playIndex === 1);
  const f = first.length ? summarize(first.map(toRecord)) : null;
  line(`■ ${label} — ${rs.length}판 (그 기기의 첫 판 ${first.length}판)`);
  line(`  첫추측(게임)     ${pct(s.firstGuessAccPerGame)}   첫 판만 ${f ? pct(f.firstGuessAccPerGame) : '   -  '}   목표 ≥ ${pct(TARGETS.firstGuessAccPerGame)} ${s.firstGuessAccPerGame >= TARGETS.firstGuessAccPerGame ? '✅' : '❌'}`);
  line(`  첫추측(추측)     ${pct(s.firstGuessAccPerGuessed)}   추측률 ${pct(s.guessRatePerGame)}`);
  if (f) line(`  (첫 판만)        추측성공 ${pct(f.solvedByGuessPerGame)} · 평균Q ${num(f.avgQuestionsAll)} — 같은 사람의 여러 판은 서로 영향을 받으므로 첫 판 지표를 우선`);
  line(`  추측성공         ${pct(s.solvedByGuessPerGame)}   후보안(엔진 성공 아님) ${pct(s.inCandidatesPerGame)}`);
  line(`  평균Q            ${num(s.avgQuestionsAll).padStart(6)}   맞힌 판 ${num(s.avgQuestionsSolved)} / 못 맞힌 판 ${num(s.avgQuestionsUnsolved)}   목표 ≤ ${TARGETS.avgQuestions} ${s.avgQuestionsAll <= TARGETS.avgQuestions ? '✅' : '❌'}`);
  line(`  게임당 추측      ${num(s.guessesPerGame, 2).padStart(6)}   고확신오답(추측) ${pct(s.highConfWrongPerHighConfGuess)} (n=${s.highConfGuesses})`);
  const src = count(rs, (r) => r.finalSource);
  const SRC: Record<string, string> = { guess: '엔진이 맞힘', candidates: '후보에서 고름', search: '검색으로 알려줌', notInList: '목록에 없음', assigned: '못 맞힘(지정 메뉴)' };
  line(`  정답 확인 경로   ${[...src].map(([k, n]) => `${SRC[k] ?? k} ${n}`).join(' · ')}`);
  line(`  되돌리기 ${num(rs.reduce((a, r) => a + (r.undoCount ?? 0), 0) / rs.length, 2)}회/판 · 평균 ${num(rs.reduce((a, r) => a + r.durationMs, 0) / rs.length / 1000)}초/판`);
}
for (const mode of ['assigned', 'free'] as const) {
  const rs = results.filter((r) => r.mode === mode);
  if (rs.length) {
    printSummary(MODE_LABEL[mode], rs);
    line();
  }
}
hr();

// ───────── 가설 2: 확신도 보정 ─────────
const all = summarize(results.filter((r) => r.finalMenuId !== null).map(toRecord));
line('가설 2. 엔진 점수 ≠ 정답 확률 — 점수 구간별 [추측 수 / 평균 점수 → 실제 정답률] (정답을 아는 판만)');
for (const c of all.calibration) line(`  ${c.range}  ${String(c.n).padStart(4)} / ${c.meanScore.toFixed(2)} → ${pct(c.accuracy)}`);
line(`  보정오차 ${num(calibrationError(all.calibration), 3)} — 엔진 가정(실수율 ${results[0].config?.slipRate ?? '?'})이 맞으면 0에 가깝다. 실제 정답률이 점수보다 낮으면 엔진이 과신 중`);
hr();

// ───────── 가설 1: 명확한 칸 일관성 → 실수율 추정 ─────────
// 예/아니요 답변만 쓴다 ('아마~'는 엔진이 이미 완화해서 반영하므로 뒤집기 모델과 맞지 않음).
// 명확한 칸 = 표 값이 0.1 이하 또는 0.9 이상 (q = min(p, 1−p) ≤ 0.1).
const cellObs = new Map<string, { yes: number; n: number }>();
const clearCells = new Map<string, { q: number; n: number; contra: number }>();
for (const r of results) {
  if (!r.finalMenuId) continue;
  const mi = mIdx.get(r.finalMenuId);
  if (mi === undefined || r.dataVersion !== data.version) continue;
  for (const e of r.events) {
    if (e.type !== 'answer' || e.answer === 'dunno') continue;
    const qi = qIdx.get(e.questionId);
    if (qi === undefined) continue;
    const p = data.matrix[mi][qi];
    const key = `${r.finalMenuId}|${e.questionId}`;
    const yes = e.answer === 'yes' || e.answer === 'probably';
    const o = cellObs.get(key) ?? { yes: 0, n: 0 };
    o.n++;
    if (yes) o.yes++;
    cellObs.set(key, o);
    if (e.answer !== 'yes' && e.answer !== 'no') continue;
    const q = Math.min(p, 1 - p);
    if (q > 0.1) continue;
    const c = clearCells.get(key) ?? { q, n: 0, contra: 0 };
    c.n++;
    if ((p >= 0.5 && !yes) || (p < 0.5 && yes)) c.contra++;
    clearCells.set(key, c);
  }
}
const slipFrom = (cells: [string, { q: number; n: number; contra: number }][]) =>
  estimateSlip(cells.flatMap(([, c]) => new Array(c.n).fill(c.q)), cells.reduce((a, [, c]) => a + c.contra, 0));
const allClear = [...clearCells];
const est = slipFrom(allClear);
/**
 * 같은 칸에서 반대 답이 "우연이라고 보기 어려울 만큼" 나오면 전역 실수가 아니라 그 칸(질문 표현·값)의 문제일 가능성이 크다.
 * 기대 반대 비율 = q + s·(1−2q) (s = 전체 추정치)일 때 이만큼 나올 이항 확률이 1% 미만인 칸만 표시한다.
 */
const repeated = allClear.filter(([, c]) => {
  const s = Number.isNaN(est.slip) ? 0 : est.slip;
  return c.contra >= 2 && binomialTail(c.n, c.contra, c.q + s * (1 - 2 * c.q)) < 0.01;
});
const estExcl = slipFrom(allClear.filter(([k]) => !repeated.some(([r]) => r === k)));
const engineSlip = results.find((r) => r.config)?.config.slipRate;
line('가설 1. 명확한 칸(표 값 ≤0.1 또는 ≥0.9)에 사람들이 일관되게 답하는가 → 실수율 추정');
line(`  예/아니요 답변 ${allClear.reduce((a, [, c]) => a + c.n, 0)}개 (현재 데이터 버전 판만)`);
line(`  관측된 반대 답변 비율     ${pct(est.observed)}`);
line(`  표가 이미 가정한 불확실성 ${pct(est.tableBaseline)}   (예: 0.98 칸이면 2%)`);
line(`  → slipRate 추정치         ${num(est.slip, 3)}   = (관측 − 표 불확실성) / (1 − 2·표 불확실성)   엔진 설정 ${engineSlip ?? '?'}`);
line('  ※ 관측 비율을 slipRate에 그대로 넣으면 표의 불확실성을 중복 반영합니다. 위 추정치를 쓰세요.');
if (repeated.length) {
  line(`  우연으로 보기 어려운 반대 답이 몰린 칸 ${repeated.length}개(이항 확률 < 1%)를 빼면 slipRate 추정치 ${num(estExcl.slip, 3)} — 이 칸들은 전역 실수율보다 질문 표현·값을 먼저 고칠 후보:`);
  for (const [k, c] of repeated.sort((a, b) => b[1].contra - a[1].contra).slice(0, 10)) {
    const [m, q] = k.split('|');
    line(`    ${menuName(m)} × ${q} (${data.questions[qIdx.get(q)!].text})  표 ${data.matrix[mIdx.get(m)!][qIdx.get(q)!]} · 반대 ${c.contra}/${c.n}`);
  }
}
line('  표본이 적을 때는 추정치가 크게 흔들립니다. 수십 개 이상 모인 뒤에 slipRate 조정을 검토하세요.');
hr();

// ───────── 가설 3: 질문별 애매한 답 비율 ─────────
const qStats = new Map<string, { n: number; dunno: number; soft: number }>();
for (const r of results) {
  for (const e of r.events) {
    if (e.type !== 'answer') continue;
    const s = qStats.get(e.questionId) ?? { n: 0, dunno: 0, soft: 0 };
    s.n++;
    if (e.answer === 'dunno') s.dunno++;
    if (e.answer === 'probably' || e.answer === 'probablyNot') s.soft++;
    qStats.set(e.questionId, s);
  }
}
line('가설 3. 질문별 애매한 답 비율 (모르겠어요 / 아마~) — 높으면 질문 문구를 고치거나 빼는 것을 검토');
const amb = [...qStats].filter(([, s]) => s.n >= 3).sort((a, b) => (b[1].dunno + b[1].soft) / b[1].n - (a[1].dunno + a[1].soft) / a[1].n);
for (const [q, s] of amb.slice(0, 12)) {
  const text = qIdx.has(q) ? data.questions[qIdx.get(q)!].text : '(현재 데이터에 없는 질문)';
  line(`  모름 ${pct(s.dunno / s.n)}  아마 ${pct(s.soft / s.n)}  (${String(s.n).padStart(3)}회)  ${q} ${text}`);
}
if (amb.length === 0) line('  (3회 이상 나온 질문이 아직 없음)');
hr();

// ───────── 가설 4: 목록에 없는 메뉴 (자유 모드만) ─────────
const freeRs = results.filter((r) => r.mode === 'free');
const missing = freeRs.filter((r) => r.notInList);
line(`가설 4. 목록에 없는 메뉴 (자유 모드) ${missing.length}/${freeRs.length}판 (${pct(missing.length / freeRs.length)}) — 20%를 넘으면 질문보다 메뉴 확장이 먼저`);
const names = count(missing, (r) => r.notInListName?.trim() || '(이름 안 적음)');
line(`  ${[...names].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}${c > 1 ? `×${c}` : ''}`).join(', ') || '-'}`);
const norm = (x: string) => x.toLowerCase().replace(/\s+/g, '');
const aliasHits = [...names.keys()].flatMap((n) => {
  const k = norm(n);
  if (k.length < 2 || n.startsWith('(')) return [];
  const hit = data.menus.find((m) => [m.name, ...m.aliases].some((x) => norm(x).includes(k) || k.includes(norm(x))));
  return hit ? [`"${n}" → ${hit.name}`] : [];
});
if (aliasHits.length) line(`  이미 목록에 있는 메뉴의 별칭·세부 변형일 수 있음 (aliases 추가 후보): ${aliasHits.join(', ')}`);
hr();

// ───────── 후보 순위는 좋은데 추측하지 못한 판 ─────────
const sameVersion = results.filter((r) => r.dataVersion === data.version && r.finalMenuId && !r.solved && r.config);
let rank1 = 0;
let top3 = 0;
const rank1Scores: number[] = [];
for (const r of sameVersion) {
  const post = computePosterior(data, r.config, { timeSlot: r.timeSlot, events: r.events });
  const top = ranked(data, post, 3);
  if (top[0]?.menuId === r.finalMenuId) {
    rank1++;
    rank1Scores.push(top[0].score);
  }
  if (top.some((t) => t.menuId === r.finalMenuId)) top3++;
}
line(`엔진이 못 맞힌 판 ${sameVersion.length}개 중 끝날 때 정답이 1위였던 판 ${rank1}개 · 3위 안 ${top3}개 (현재 데이터 버전, 정답을 아는 판)`);
if (rank1) line(`  1위였던 판의 평균 점수 ${num(rank1Scores.reduce((a, b) => a + b, 0) / rank1, 2)} (임계값 ${sameVersion[0].config.guessThreshold}) — 많으면 추측 임계값·종료 규칙 조정 후보`);
hr();

// ───────── 데이터 검수 후보 ─────────
line('표와 실제 답이 크게 다른 칸 (3회 이상 답변, |실제 예 비율 − 표 값| ≥ 0.4) → matrix.csv 검수 후보');
const off = [...cellObs].filter(([, o]) => o.n >= 3).map(([k, o]) => {
  const [m, q] = k.split('|');
  const p = data.matrix[mIdx.get(m)!][qIdx.get(q)!];
  return { m, q, p, obs: o.yes / o.n, n: o.n };
}).filter((x) => Math.abs(x.obs - x.p) >= 0.4).sort((a, b) => Math.abs(b.obs - b.p) - Math.abs(a.obs - a.p));
for (const x of off.slice(0, 15)) line(`  ${menuName(x.m)} × ${x.q}  표 ${x.p} → 실제 ${x.obs.toFixed(2)} (${x.n}회)`);
if (off.length === 0) line('  (아직 없음)');
hr();

// ───────── 오답 ─────────
const wrong = new Map<string, number>();
for (const r of results) {
  if (!r.finalMenuId) continue;
  for (const g of r.guesses) if (!g.correct) {
    const k = `${r.finalMenuId}→${g.menuId}`;
    wrong.set(k, (wrong.get(k) ?? 0) + 1);
  }
}
line('자주 틀린 추측 (정답 → 엔진의 추측) — 두 메뉴를 가를 질문 후보를 찾는 출발점');
for (const [k, n] of [...wrong].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  const [t, g] = k.split('→');
  line(`  ${String(n).padStart(3)}회  ${menuName(t)} → ${menuName(g)}?`);
}
if (wrong.size === 0) line('  (없음)');
hr();

// ───────── 가설 5: 시간대 ─────────
line('가설 5. 시간대별로 실제 떠올린 메뉴 (자유 모드만, 시간대 가중치 검증용. 현재 엔진은 시간대 가중치 OFF)');
const slotLabel: Record<string, string> = { morning: '아침', lunch: '점심', dinner: '저녁', latenight: '야식' };
for (const slot of ['morning', 'lunch', 'dinner', 'latenight'] as const) {
  const rs = freeRs.filter((r) => r.timeSlot === slot && r.finalMenuId);
  if (rs.length === 0) continue;
  const c = count(rs, (r) => r.finalMenuId!);
  const top = [...c].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m, n]) => `${menuName(m)}${n > 1 ? `×${n}` : ''}`);
  const avgW = rs.reduce((s, r) => s + data.menus[mIdx.get(r.finalMenuId!)!].timeWeights[slot], 0) / rs.length;
  line(`  ${slotLabel[slot]} ${rs.length}판 · 정답 메뉴의 평균 가중치 ${avgW.toFixed(2)} (1보다 크면 가중치가 맞는 방향) · ${top.join(', ')}`);
}
hr();
line('다음 조치 체크리스트 (반복해서 나타나는 실패만 근거로 삼을 것)');
const freeMissingRate = freeRs.length ? missing.length / freeRs.length : 0;
const unsolvedKnown = sameVersion.length;
const checks: [boolean, string, string][] = [
  [freeMissingRate >= 0.2, `목록 밖 메뉴가 자유 모드의 ${pct(freeMissingRate).trim()}`, '별칭·세부 변형인지 먼저 확인 → 아니면 메뉴 확장'],
  [amb.some(([, st]) => (st.dunno + st.soft) / st.n >= 0.4) || off.length > 0, '같은 질문·칸에서 답이 갈림 (가설 3, 표와 다른 칸)', '질문 표현과 해당 확률값 수정'],
  [[...wrong.values()].some((n) => n >= 2), '특정 메뉴끼리 반복 혼동 (자주 틀린 추측)', '두 메뉴를 가르는 질문 추가'],
  [unsolvedKnown > 0 && rank1 / unsolvedKnown >= 0.3, `못 맞힌 판의 ${pct(unsolvedKnown ? rank1 / unsolvedKnown : 0).trim()}에서 정답이 1위였음`, '추측 임계값·종료 규칙 조정'],
  [starts.length > 0 && resultKeys.size / new Set(starts.map((x) => `${x.deviceId}|${x.playIndex}`)).size < TARGETS.completionRate, '중도 종료가 많음 (완료율 목표 미달)', '질문 수·플레이 흐름 개선, 테스터 메모 확인'],
  [repeated.length > 0, '명확한 칸에서 반대 답이 반복', '전역 slipRate보다 해당 질문·값을 먼저 수정'],
];
for (const [hit, what, todo] of checks) line(`  ${hit ? '⚠️ ' : '·  '} ${what.padEnd(40)} → ${todo}`);
line('  (⚠️ = 이번 결과에서 해당. 판 수가 적으면 우연일 수 있으니 테스터 메모와 함께 판단)');
hr();
line('지표 정의');
for (const d of METRIC_DEFINITIONS) line(`  ${d}`);
hr();

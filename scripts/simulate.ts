// 시뮬레이터. 사용: npm run sim -- [--n 40] [--nr 15] [--seed 1] [--alpha 1] [--threshold 0.7] [--soft 0.5]
//   [--slip 0.05] [--only A0,A,B1,B4,T] [--data <엔진 json>] [--user-data <가상 사용자 json>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG, TIME_SLOTS, type EngineConfig, type GameData, type TimeSlot,
} from '../src/engine/index.ts';
import { analyzeData } from './lib/analysis.ts';
import {
  calibrationError, METRIC_DEFINITIONS, num, pct, summarize, TARGETS, type Summary,
} from './lib/metrics.ts';
import {
  BASIC_STYLE, loadUserMatrix, makeRng, perturbMatrix, playGame, sampleIndex, withoutMenu,
  type Rng, type SimGame, type UserStyle,
} from './lib/sim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const strArg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const N = arg('n', 40);
const NR = arg('nr', 15);
const SEED = arg('seed', 1);
/** --only A0,A,B1_0.2,B4,T 처럼 일부 시나리오만 실행 (빠른 실험용) */
const only = strArg('only')?.split(',');
const want = (key: string) => !only || only.some((k) => key === k || key.startsWith(k + '_'));

const dataPath = strArg('data') ?? join(root, 'src/generated/data.json');
const data: GameData = JSON.parse(readFileSync(dataPath, 'utf8'));
/** --user-data: 가상 사용자가 따르는 표. 메뉴·질문 id로 맞춰 읽으므로 질문 구성이 다른 버전끼리도 비교 가능 */
const userDataPath = strArg('user-data');
const userMatrix = userDataPath
  ? loadUserMatrix(JSON.parse(readFileSync(userDataPath, 'utf8')), data)
  : data.matrix;
const config: EngineConfig = {
  ...DEFAULT_CONFIG,
  useTimePrior: false,
  evidenceWeight: arg('alpha', DEFAULT_CONFIG.evidenceWeight),
  guessThreshold: arg('threshold', DEFAULT_CONFIG.guessThreshold),
  softFactor: arg('soft', DEFAULT_CONFIG.softFactor),
  slipRate: arg('slip', DEFAULT_CONFIG.slipRate),
};
const nameOf = new Map(data.menus.map((m) => [m.id, m.name]));
const started = Date.now();

/** 모든 메뉴를 정답으로 n판씩 (정답 분포 균등 = 엔진의 균등 사전확률과 일치) */
function runPerMenu(n: number, opts: { style?: UserStyle; userMatrix?: number[][]; cfg?: EngineConfig; rng: Rng }): SimGame[] {
  const out: SimGame[] = [];
  const um = opts.userMatrix ?? userMatrix;
  data.menus.forEach((m, mi) => {
    for (let k = 0; k < n; k++) {
      out.push(playGame(data, opts.cfg ?? config, 'lunch', um[mi], m.id, opts.style ?? BASIC_STYLE, opts.rng));
    }
  });
  return out;
}

// ───────── 시나리오 실행 ─────────
const scenarios: { key: string; label: string; summary: Summary }[] = [];
const add = (key: string, label: string, games: () => SimGame[]) => {
  if (want(key)) scenarios.push({ key, label, summary: summarize(games()) });
};

// A0: 엔진 가정과 가상 사용자가 완전히 일치하는 조건. 예/아니요만, 실수·상관 응답 없음, α=1,
// 정답 분포 = 사전확률(균등), 사용자 생성 확률 = 엔진 likelihood (엔진 실수율도 0으로 맞춤).
// 이 조건에서는 베이즈 계산이 정확하므로 점수와 실제 정답률이 거의 같아야 한다 (보정오차 ≈ 0).
// 크게 어긋나면 계산·집계 버그를 의심해야 한다.
add('A0', 'A0. 모델 일치 검증 (실수 0%, α=1)', () => runPerMenu(N, {
  style: { ...BASIC_STYLE, noise: 0 },
  cfg: { ...config, evidenceWeight: 1, slipRate: 0 },
  rng: makeRng(SEED + 1),
}));

const gamesA = runPerMenu(N, { rng: makeRng(SEED) });
scenarios.push({ key: 'A', label: 'A. 기본 (표대로 답함 + 실수 5%)', summary: summarize(gamesA) });

for (const r of [0.1, 0.2, 0.3]) {
  const rng = makeRng(SEED + 100 + r * 100);
  add(`B1_${r}`, `B1. 인식 차이 ${r * 100}% 칸`, () => runPerMenu(NR, { userMatrix: perturbMatrix(userMatrix, r, rng), rng }));
}
add('B2', 'B2. 신중형 (아마도 30%, 모름 15%)',
  () => runPerMenu(NR, { style: { ...BASIC_STYLE, softRate: 0.3, dunnoRate: 0.15 }, rng: makeRng(SEED + 200) }));
add('B3', 'B3. 상관 응답 (group별 ±0.3)',
  () => runPerMenu(NR, { style: { ...BASIC_STYLE, groupShift: 0.3 }, rng: makeRng(SEED + 300) }));
for (const noise of [0.1, 0.2]) {
  add(`B5_${noise}`, `B5. 실수 ${noise * 100}%`, () => runPerMenu(NR, { style: { ...BASIC_STYLE, noise }, rng: makeRng(SEED + 500 + noise * 100) }));
}

// B4: 목록에 없는 메뉴 (leave-one-out). 맞히는 것이 불가능하므로 "얼마나 자신만만하게 틀리는가"를 본다.
const rngB4 = makeRng(SEED + 400);
const gamesB4: SimGame[] = [];
if (want('B4')) data.menus.forEach((m, mi) => {
  const reduced = withoutMenu(data, mi);
  for (let k = 0; k < Math.ceil(NR / 2); k++) {
    gamesB4.push(playGame(reduced, config, 'lunch', userMatrix[mi], m.id, BASIC_STYLE, rngB4));
  }
});
const b4 = gamesB4.length === 0 ? null : {
  games: gamesB4.length,
  guessesPerGame: gamesB4.reduce((s, g) => s + g.guesses.length, 0) / gamesB4.length,
  highConfWrongGamePerGame: gamesB4.filter((g) => g.guesses.some((x) => x.score >= 0.9)).length / gamesB4.length,
  noGuessPerGame: gamesB4.filter((g) => g.guesses.length === 0).length / gamesB4.length,
};

// T: 시간대 사전확률. 정답 분포가 균등일 때(가중치가 틀림)와 가중치대로일 때(가중치가 맞음) 각각 ON/OFF.
const timeRows: { label: string; on: Summary; off: Summary }[] = [];
for (const dist of want('T') ? (['uniform', 'prior'] as const) : []) {
  const res: Record<'on' | 'off', SimGame[]> = { on: [], off: [] };
  for (const mode of ['on', 'off'] as const) {
    const rng = makeRng(SEED + 600);
    const cfg = { ...config, useTimePrior: mode === 'on' };
    for (const slot of TIME_SLOTS as readonly TimeSlot[]) {
      const w = data.menus.map((m) => (dist === 'prior' ? m.timeWeights[slot] : 1));
      for (let k = 0; k < (data.menus.length * NR) / 4; k++) {
        const mi = sampleIndex(w, rng);
        res[mode].push(playGame(data, cfg, slot, userMatrix[mi], data.menus[mi].id, BASIC_STYLE, rng));
      }
    }
  }
  timeRows.push({
    label: dist === 'uniform' ? '정답 분포 균등 (가중치가 틀린 경우)' : '정답 분포 = 가중치 (가중치가 맞은 경우)',
    on: summarize(res.on),
    off: summarize(res.off),
  });
}

// ───────── A 상세 분석 ─────────
const perMenu = data.menus.map((m) => {
  const s = summarize(gamesA.filter((g) => g.target === m.id));
  return { id: m.id, name: m.name, firstGuessAccPerGame: s.firstGuessAccPerGame, solvedByGuessPerGame: s.solvedByGuessPerGame, avgQuestionsAll: s.avgQuestionsAll };
}).sort((a, b) => a.firstGuessAccPerGame - b.firstGuessAccPerGame || b.avgQuestionsAll - a.avgQuestionsAll);

const confusion = new Map<string, number>();
for (const g of gamesA) {
  for (const x of g.guesses) {
    if (x.correct) continue;
    const key = [g.target!, x.menuId].sort().join('|');
    confusion.set(key, (confusion.get(key) ?? 0) + 1);
  }
}
const confusedPairs = [...confusion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  .map(([k, c]) => ({ a: k.split('|')[0], b: k.split('|')[1], count: c }));

const analysis = analyzeData(data);
const askedIn = new Map<string, number>();
for (const g of gamesA) for (const q of new Set(g.answers.map((a) => a.questionId))) askedIn.set(q, (askedIn.get(q) ?? 0) + 1);
const questionUse = analysis.questionStats.map((q) => ({
  ...q,
  askedRate: (askedIn.get(q.id) ?? 0) / gamesA.length,
})).sort((a, b) => a.askedRate - b.askedRate);

const confidentWrong = gamesA.flatMap((g) => g.guesses.filter((x) => !x.correct).map((x) => ({ g, x })))
  .sort((p, q) => q.x.score - p.x.score).slice(0, 10)
  .map(({ g, x }) => ({
    target: g.target!, guessed: x.menuId, score: x.score, afterQuestions: x.afterQuestions,
    answers: g.answers.slice(0, x.afterQuestions).map((a) => `${a.questionId}=${a.answer}`),
  }));

// ───────── 출력 ─────────
const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(100));
line();
line('⚠️  시뮬레이터 결과는 실제 사용자 정확도가 아닙니다.');
line('    A는 "사람이 확률표대로 답한다"고 가정했을 때의 성능입니다. 상한선이 아닙니다:');
line('    실제 사람이 표보다 일관되게 답하면 더 높게, 표와 다르게 인식하면 더 낮게 나옵니다.');
line('    진짜 정확도는 실사용 테스트(npm run analyze)로만 확인할 수 있습니다.');
hr();
line(`데이터 ${data.version} · 메뉴 ${data.menus.length} · 질문 ${data.questions.length} · seed ${SEED} · A ${N}판/메뉴 · B ${NR}판/메뉴`);
if (userDataPath) line(`가상 사용자 표: ${userDataPath}`);
line(`설정: 임계값 ${config.guessThreshold} · 최소 ${config.minQuestions} · 최대 ${config.maxQuestions} · α ${config.evidenceWeight} · 실수율 ${config.slipRate} · 완화 ${config.softFactor}`);
line(`목표(실사용): 첫추측(게임) ≥ ${pct(TARGETS.firstGuessAccPerGame)} · 평균Q ≤ ${TARGETS.avgQuestions}`);
hr();
line('시나리오                          첫추측(게임) 첫추측(추측) 추측률  추측성공  후보안   평균Q  고확신오답(추측)(n)  (게임)  보정오차');
for (const s of scenarios) {
  const x = s.summary;
  line(`${s.label.padEnd(30)} ${pct(x.firstGuessAccPerGame)}    ${pct(x.firstGuessAccPerGuessed)}   ${pct(x.guessRatePerGame)} ${pct(x.solvedByGuessPerGame)} ${pct(x.inCandidatesPerGame)}  ${num(x.avgQuestionsAll).padStart(5)}   ${pct(x.highConfWrongPerHighConfGuess)}${`(${x.highConfGuesses})`.padEnd(7)} ${pct(x.highConfWrongGamePerGame)}  ${num(calibrationError(x.calibration), 3)}`);
}
hr();
const a0 = scenarios.find((s) => s.key === 'A0');
if (a0) {
  const ece = calibrationError(a0.summary.calibration);
  line(`A0 검증: 보정오차 ${ece.toFixed(3)} ${ece <= 0.03 ? '✅ 엔진 계산·집계가 모델과 일치' : '❌ 모델 일치 조건인데 점수와 정답률이 어긋남 → 계산·집계 확인 필요'}`);
  hr();
}
line('확신도 보정 — 엔진 점수 구간별 [추측 수 / 평균 점수 → 실제 정답률]');
const calRows = ['A0', 'A', 'B1_0.2'].map((k) => scenarios.find((s) => s.key === k)).filter((s) => s !== undefined);
const ranges = [...new Set(calRows.flatMap((s) => s.summary.calibration.map((c) => c.range)))].sort();
line(`  구간        ${calRows.map((s) => s.key.padEnd(26)).join('')}`);
for (const r of ranges) {
  const cells = calRows.map((s) => {
    const c = s.summary.calibration.find((x) => x.range === r);
    return (c ? `${String(c.n).padStart(5)} / ${c.meanScore.toFixed(2)} → ${pct(c.accuracy)}` : '      -').padEnd(26);
  });
  line(`  ${r}  ${cells.join('')}`);
}
hr();
if (b4) {
  line('B4. 목록에 없는 메뉴 (정답 불가능 — 적게, 덜 자신 있게 틀릴수록 좋음)');
  line(`  게임당 추측 ${num(b4.guessesPerGame, 2)}회 · 0.9 이상으로 틀린 게임 ${pct(b4.highConfWrongGamePerGame)} · 추측 없이 후보 공개 ${pct(b4.noGuessPerGame)}  (분모: 전체 ${b4.games}게임)`);
  hr();
}
if (timeRows.length) {
  line('T. 시간대 사전확률 ON/OFF (첫추측(게임) / 평균Q)');
  for (const t of timeRows) {
    line(`  ${t.label.padEnd(30)} ON ${pct(t.on.firstGuessAccPerGame)} / ${num(t.on.avgQuestionsAll)}   OFF ${pct(t.off.firstGuessAccPerGame)} / ${num(t.off.avgQuestionsAll)}`);
  }
  line('  → 어느 쪽이 현실인지는 시뮬레이터로 판정 불가. 실사용 로그의 timeSlot으로 판정해야 함.');
  hr();
}
line('메뉴별 (A, 나쁜 순 15개): 첫추측(게임) / 추측성공 / 평균Q');
for (const m of perMenu.slice(0, 15)) line(`  ${m.name.padEnd(12)} ${pct(m.firstGuessAccPerGame)} ${pct(m.solvedByGuessPerGame)} ${num(m.avgQuestionsAll).padStart(5)}`);
hr();
line('자주 혼동되는 메뉴 쌍 (A, 틀린 추측 횟수)');
for (const p of confusedPairs.slice(0, 15)) line(`  ${String(p.count).padStart(4)}  ${nameOf.get(p.a)} ↔ ${nameOf.get(p.b)}`);
hr();
line(`데이터 분석: 구분이 어려운 쌍 ${analysis.hardPairs.length}개 · 완전 동일 ${analysis.identicalPairs.length}개 · 중복 의심 질문 ${analysis.redundantQuestions.length}쌍 (상세: npm run data)`);
hr();
line('질문 사용률 (A, 낮은 순 15개) — 사용률만으로 삭제하지 말 것. 유일구분 > 0이면 그 질문만 가르는 메뉴 쌍이 있음');
line('  사용률   초기IG  유일구분  질문');
for (const q of questionUse.slice(0, 15)) {
  line(`  ${pct(q.askedRate)}  ${q.initialGainBits.toFixed(3)}  ${String(q.uniquePairs).padStart(6)}    ${q.id} ${q.text}`);
}
hr();
line('확신은 높은데 틀린 사례 (A, 상위 10)');
for (const c of confidentWrong) {
  line(`  ${nameOf.get(c.target)} → "${nameOf.get(c.guessed)}?" (${c.score.toFixed(3)}, ${c.afterQuestions}문항)`);
  line(`     ${c.answers.join(' ')}`);
}
hr();
line('지표 정의');
for (const d of METRIC_DEFINITIONS) line(`  ${d}`);
hr();

// ───────── 저장 + 직전 리포트와 비교 ─────────
const report = {
  createdAt: new Date().toISOString(),
  dataVersion: data.version,
  userData: userDataPath ?? null,
  params: { N, NR, SEED, config },
  scenarios, b4, timeRows, perMenu, confusedPairs, questionUse, confidentWrong,
  dataAnalysis: { hardPairs: analysis.hardPairs.length, identicalPairs: analysis.identicalPairs.length, redundantQuestions: analysis.redundantQuestions },
};
const dir = join(root, 'reports');
mkdirSync(dir, { recursive: true });
const latest = join(dir, 'latest.json');
if (!only && existsSync(latest)) {
  const prev = JSON.parse(readFileSync(latest, 'utf8')) as typeof report;
  const comparable = prev.scenarios.some((s) => 'firstGuessAccPerGame' in s.summary);
  if (comparable) {
    line(`직전 리포트 대비 (데이터 ${prev.dataVersion} → ${data.version}, 첫추측(게임) %p / 평균Q)`);
    if ((prev.userData ?? null) !== report.userData) line('  ⚠️  가상 사용자 표가 달라서 비교가 공정하지 않습니다.');
    for (const s of scenarios) {
      const p = prev.scenarios.find((x) => x.key === s.key);
      if (!p) continue;
      const d = (s.summary.firstGuessAccPerGame - p.summary.firstGuessAccPerGame) * 100;
      const dq = s.summary.avgQuestionsAll - p.summary.avgQuestionsAll;
      line(`  ${s.label.padEnd(30)} ${d >= 0 ? '+' : ''}${d.toFixed(1)}%p  ${dq >= 0 ? '+' : ''}${dq.toFixed(2)}`);
    }
    line('  ※ 데이터를 바꾸면 가상 사용자도 같이 바뀝니다. 엔진 개선만 보려면 --user-data로 사용자 표를 고정하세요.');
    hr();
  }
}
if (!only) {
  const stamp = report.createdAt.replace(/[:.]/g, '-');
  writeFileSync(join(dir, `sim-${stamp}.json`), JSON.stringify(report, null, 2));
  writeFileSync(latest, JSON.stringify(report, null, 2));
  line(`저장: reports/sim-${stamp}.json  (${((Date.now() - started) / 1000).toFixed(1)}초)`);
} else {
  line(`(--only 실행은 리포트를 저장하지 않음 · ${((Date.now() - started) / 1000).toFixed(1)}초)`);
}
